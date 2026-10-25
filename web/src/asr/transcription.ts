import { claimJob, fetchRecordingBlob, putSegments, updateJob } from "../api/notesApi";
import { blobToMono16k } from "../audio/pcm";
import { getModelUrls, getModelStatus } from "./modelStore";

const DEVICE_ID_KEY = "taskmaster.deviceId";

export interface TranscriptChunk {
  text: string;
  timestamp: [number, number];
}

export interface TranscriptWord {
  text: string;
  start_time: number;
  end_time: number;
}

export interface TranscriptionResult {
  text: string;
  chunks: TranscriptChunk[];
  words: TranscriptWord[];
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function transcriptionCapability() {
  const threadsAvailable =
    typeof SharedArrayBuffer !== "undefined" && typeof window !== "undefined" && window.crossOriginIsolated;
  const hardware = navigator.hardwareConcurrency || 4;
  return {
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    threads: threadsAvailable,
    threadCount: threadsAvailable ? Math.min(4, Math.max(1, Math.floor(hardware / 2))) : 1,
  };
}

export async function isModelReady(): Promise<boolean> {
  const status = await getModelStatus();
  return status.ready;
}

let worker: Worker | null = null;
let modelLoaded = false;
let requestId = 0;
const requests = new Map<
  number,
  { resolve: (value: TranscriptionResult) => void; reject: (error: Error) => void }
>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./asr.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as
      | { type: "loaded"; id: number }
      | { type: "result"; id: number; text: string; chunks: TranscriptChunk[]; words: TranscriptWord[] }
      | { type: "error"; id: number; error: string };

    if (data.type === "loaded") return;

    const pending = requests.get(data.id);
    if (!pending) return;
    requests.delete(data.id);

    if (data.type === "error") pending.reject(new Error(data.error));
    else pending.resolve({ text: data.text, chunks: data.chunks, words: data.words });
  });
  return worker;
}

async function loadModelInWorker(): Promise<void> {
  if (modelLoaded) return;
  const urls = await getModelUrls();
  const capability = transcriptionCapability();
  const instance = ensureWorker();

  await new Promise<void>((resolve, reject) => {
    const id = ++requestId;
    const timeout = window.setTimeout(() => reject(new Error("Modell konnte nicht geladen werden")), 300_000);

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type: string; id: number; error?: string };
      if (data.id !== id) return;
      if (data.type === "loaded") {
        window.clearTimeout(timeout);
        instance.removeEventListener("message", onMessage);
        resolve();
      } else if (data.type === "error") {
        window.clearTimeout(timeout);
        instance.removeEventListener("message", onMessage);
        reject(new Error(data.error ?? "Modell konnte nicht geladen werden"));
      }
    };

    instance.addEventListener("message", onMessage);
    instance.postMessage({
      type: "load",
      id,
      ...urls,
      threads: capability.threadCount,
      wasmPaths: new URL("/ort/", window.location.origin).toString(),
    });
  });

  modelLoaded = true;
}

function transcribePcm(pcm: Float32Array): Promise<TranscriptionResult> {
  const instance = ensureWorker();
  return new Promise<TranscriptionResult>((resolve, reject) => {
    const id = ++requestId;
    requests.set(id, { resolve, reject });
    instance.postMessage({ type: "transcribe", id, pcm }, [pcm.buffer]);
  });
}

function splitSentences(words: TranscriptWord[]): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      text: current.map((word) => word.text).join(" "),
      timestamp: [current[0].start_time, current[current.length - 1].end_time],
    });
    current = [];
  };

  for (const word of words) {
    current.push(word);
    if (/[.!?]$/.test(word.text) || current.length >= 18) flush();
  }
  flush();
  return chunks;
}

export function buildSegments(result: TranscriptionResult, durationMs: number) {
  const chunks = result.chunks.length > 0 ? result.chunks : splitSentences(result.words);
  if (chunks.length > 0) {
    return chunks
      .map((chunk) => ({
        startMs: Math.max(0, Math.round(chunk.timestamp[0] * 1000)),
        endMs: Math.max(0, Math.round(chunk.timestamp[1] * 1000)),
        text: chunk.text.trim(),
      }))
      .filter((segment) => segment.text.length > 0);
  }
  if (result.text.trim().length > 0) {
    return [{ startMs: 0, endMs: durationMs, text: result.text.trim() }];
  }
  return [];
}

/** Diktat in ein Textfeld: lokale Aufnahme ohne Server-Umweg transkribieren. */
export async function transcribeBlob(blob: Blob): Promise<TranscriptionResult> {
  await loadModelInWorker();
  const pcm = await blobToMono16k(blob);
  return transcribePcm(pcm);
}

export async function runTranscriptionJob(): Promise<boolean> {
  await loadModelInWorker();
  const claimed = await claimJob(getDeviceId());
  if (!claimed) return false;

  const { job, recording } = claimed;

  // Lange Aufnahmen brauchen Minuten; ohne Heartbeat läuft die Lease ab und ein
  // anderer Tab könnte den Job übernehmen.
  const heartbeat = window.setInterval(() => {
    void updateJob(job.id, {
      status: "running",
      progressMs: Math.round(recording.durationMs * 0.2),
    }).catch(() => {});
  }, 30_000);

  try {
    await updateJob(job.id, { status: "running", progressMs: 0 });
    const blob = await fetchRecordingBlob(recording.id);
    await updateJob(job.id, { status: "running", progressMs: Math.round(recording.durationMs * 0.2) });
    const pcm = await blobToMono16k(blob);
    const result = await transcribePcm(pcm);
    const segments = buildSegments(result, recording.durationMs);
    await putSegments(recording.id, segments);
    return true;
  } catch (error) {
    await updateJob(job.id, { status: "failed", error: String(error) }).catch(() => {});
    throw error;
  } finally {
    window.clearInterval(heartbeat);
  }
}

export async function runAllTranscriptionJobs(
  onJob?: (index: number, total: number) => void
): Promise<number> {
  let processed = 0;
  for (let index = 0; index < 100; index++) {
    onJob?.(index, index + 1);
    const didWork = await runTranscriptionJob();
    if (!didWork) break;
    processed += 1;
  }
  return processed;
}
