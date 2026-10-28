import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Segment } from "./segments.js";

/**
 * Schnittstelle zur Inferenz. Im Betrieb läuft sie in einem Worker-Thread:
 * das Modell braucht 1,5–2 GB und blockiert die Event-Loop – im Hauptthread
 * würde während der Transkription kein einziger HTTP-Request mehr beantwortet.
 */
export interface TranscribeRequest {
  filePath: string;
  mimeType: string;
  durationMs: number;
}

export interface TranscribeHooks {
  onProgress?: (progressMs: number) => void;
}

export interface TranscriptionEngine {
  readonly loaded: boolean;
  transcribe(request: TranscribeRequest, hooks: TranscribeHooks, timeoutMs: number): Promise<Segment[]>;
  dispose(): Promise<void>;
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "loaded" }
  | { type: "progress"; id: number; progressMs: number }
  | { type: "result"; id: number; segments: Segment[] }
  | { type: "error"; id: number; message: string };

function resolveWorkerPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const built = path.join(here, "transcribe.worker.js");
  // Dev (tsx) lädt die .ts direkt, Produktion die kompilierte .js daneben.
  return existsSync(built) ? built : path.join(here, "transcribe.worker.ts");
}

interface Pending {
  resolve: (segments: Segment[]) => void;
  reject: (error: Error) => void;
  onProgress?: (progressMs: number) => void;
  timer: NodeJS.Timeout;
}

export class WorkerTranscriptionEngine implements TranscriptionEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private isLoaded = false;

  get loaded(): boolean {
    return this.isLoaded;
  }

  private ensureWorker(): { worker: Worker; ready: Promise<void> } {
    if (this.worker) return { worker: this.worker, ready: this.ready! };

    const worker = new Worker(resolveWorkerPath());
    worker.unref();

    const ready = new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      worker.once("error", onError);
      worker.on("message", (message: WorkerMessage) => {
        if (message.type === "ready") {
          worker.off("error", onError);
          resolve();
        }
      });
      worker.once("exit", (code) => {
        if (code !== 0) {
          const error = new Error(`Transkriptions-Worker beendet (Code ${code})`);
          reject(error);
          for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
          }
          this.pending.clear();
          this.worker = null;
          this.ready = null;
          this.isLoaded = false;
        }
      });
    });

    worker.on("message", (message: WorkerMessage) => {
      if (message.type === "loaded") {
        this.isLoaded = true;
        return;
      }
      if (message.type === "progress") {
        this.pending.get(message.id)?.onProgress?.(message.progressMs);
        return;
      }
      if (message.type === "result" || message.type === "error") {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.type === "result") pending.resolve(message.segments);
        else pending.reject(new Error(message.message));
      }
    });

    this.worker = worker;
    this.ready = ready;
    return { worker, ready };
  }

  async transcribe(request: TranscribeRequest, hooks: TranscribeHooks, timeoutMs: number): Promise<Segment[]> {
    const { worker, ready } = this.ensureWorker();
    await ready;

    const id = this.nextId++;

    return new Promise<Segment[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Harte Obergrenze: der Worker wird abgerissen, damit ein hängender
        // Decoder nicht das gesamte Zeitbudget der Nacht frisst.
        void this.dispose();
        reject(new Error(`Zeitlimit für diesen Job überschritten (${Math.round(timeoutMs / 60_000)} min)`));
      }, timeoutMs);
      timer.unref();

      this.pending.set(id, { resolve, reject, onProgress: hooks.onProgress, timer });
      worker.postMessage({ type: "transcribe", id, ...request });
    });
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    this.isLoaded = false;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Transkription abgebrochen"));
    }
    this.pending.clear();
    if (worker) await worker.terminate();
  }
}
