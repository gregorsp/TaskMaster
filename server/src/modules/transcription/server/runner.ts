import { existsSync } from "node:fs";
import { config } from "../../../config.js";
import { audioFilePath } from "../../recordings/audio.storage.js";
import {
  getJobById,
  listServerQueue,
  markJobFailed,
  releaseJob,
  replaceSegmentsInternal,
  sweepStaleJobs,
  takeOverJob,
  touchJobProgress,
} from "../../recordings/recordings.service.js";
import { MAX_SERVER_AUDIO_MS } from "./decode.js";
import { WorkerTranscriptionEngine, type TranscriptionEngine } from "./engine.js";
import { ensureModel } from "./modelStore.js";
import { appendRun, type RunSummary } from "./runlog.js";
import { zonedParts } from "./schedule.js";

/** Ein Lauf endet spätestens zu dieser Uhrzeit, auch wenn das Budget übrig ist. */
export const RUN_DEADLINE = "08:00";

export interface RunOptions {
  triggeredBy: RunSummary["triggeredBy"];
  /** Testbar: Engine austauschen. Ohne Angabe läuft die Inferenz im Worker. */
  engine?: TranscriptionEngine;
  budgetMs?: number;
  jobLimitMs?: number;
  /** Nur für Tests: "jetzt". */
  now?: () => Date;
  log?: (message: string) => void;
}

let activeRun: { abort: () => void } | null = null;
let activeEngine: TranscriptionEngine | null = null;

export function isTranscriptionRunActive(): boolean {
  return activeRun !== null;
}

/** Für den Admin-Block: ist das Modell gerade im Speicher? */
export function isModelLoaded(): boolean {
  return activeEngine?.loaded ?? false;
}

/** Bricht den laufenden Lauf ab (Shutdown). Der aktuelle Job geht zurück auf "pending". */
export function abortTranscriptionRun(): void {
  activeRun?.abort();
}

function deadlineReached(now: Date): boolean {
  const parts = zonedParts(now, config.transcriptionTz);
  const [hour, minute] = RUN_DEADLINE.split(":").map(Number);
  return parts.hour * 60 + parts.minute >= hour * 60 + minute;
}

/**
 * Ein Durchlauf: Warteschlange bestimmen, Modell sicherstellen, Jobs einzeln
 * übernehmen und schreiben. Ein Fehler pro Job beendet nie den ganzen Lauf.
 */
export async function runTranscriptionBatch(options: RunOptions): Promise<RunSummary> {
  if (activeRun) throw Object.assign(new Error("Es läuft bereits eine Transkription"), { code: "RUN_ACTIVE" });

  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.log(`[transcription] ${message}`));
  const budgetMs = options.budgetMs ?? config.transcribeBudgetMs;
  const jobLimitMs = options.jobLimitMs ?? config.transcribeJobLimitMs;

  let stopped = false;
  let currentJobId: string | null = null;
  let engine = options.engine ?? null;
  const ownsEngine = !options.engine;

  activeRun = {
    abort: () => {
      stopped = true;
      if (currentJobId) releaseJob(currentJobId);
      currentJobId = null;
      void engine?.dispose();
    },
  };

  const startedAt = now();
  // Das harte Ende um 08:00 gilt für den Zeitplan, nicht für einen vom Admin
  // ausgelösten Lauf: der soll auch um 17 Uhr noch arbeiten dürfen.
  const enforceDeadline = options.triggeredBy !== "admin";
  let processed = 0;
  let failed = 0;
  let stoppedBy: string | null = null;
  let skipped: string | null = null;

  try {
    const swept = sweepStaleJobs(startedAt);
    if (swept.released > 0) log(`${swept.released} hängende Jobs wieder freigegeben`);

    const queue = listServerQueue(startedAt);
    if (queue.length === 0) {
      log("nichts zu tun");
      skipped = "queue-empty";
    } else {
      log(`${queue.length} Jobs in der Warteschlange`);

      // Eine injizierte Engine (Tests) braucht kein Modell auf der Platte.
      if (!options.engine) {
        try {
          await ensureModel(log);
        } catch (error) {
          skipped = `model: ${(error as Error).message}`;
          log(`Lauf übersprungen – ${skipped}`);
        }
      }
    }

    if (!skipped) {
      if (!engine) engine = new WorkerTranscriptionEngine();
      activeEngine = engine;

      for (const entry of queue) {
        if (stopped) {
          stoppedBy = "shutdown";
          break;
        }
        if (now().getTime() - startedAt.getTime() >= budgetMs) {
          stoppedBy = "budget";
          break;
        }
        if (enforceDeadline && deadlineReached(now())) {
          stoppedBy = "deadline";
          break;
        }

        // Der Snapshot kann veraltet sein: in der Zwischenzeit kann ein Client
        // den Job fertig transkribiert haben.
        const fresh = getJobById(entry.job.id);
        if (!fresh || fresh.status === "done") continue;

        if (entry.recording.durationMs > MAX_SERVER_AUDIO_MS) {
          markJobFailed(
            entry.job.id,
            `Aufnahme ist für die Server-Transkription zu lang (${Math.round(entry.recording.durationMs / 60_000)} min)`
          );
          failed += 1;
          continue;
        }

        const takenOver = takeOverJob(entry.job.id);
        if (!takenOver) continue;
        currentJobId = takenOver.job.id;

        try {
          const filePath = audioFilePath(takenOver.recording.filename);
          if (!existsSync(filePath)) throw new Error("Audiodatei fehlt auf dem Server");

          const segments = await engine.transcribe(
            {
              filePath,
              mimeType: takenOver.recording.mimeType,
              durationMs: takenOver.recording.durationMs,
            },
            {
              onProgress: (progressMs) => {
                // Fortschritt ist reine Anzeige; ein Schreibfehler darf den
                // Lauf nicht abbrechen.
                try {
                  touchJobProgress(takenOver.job.id, progressMs, takenOver.job.epoch);
                } catch {
                  /* ignore */
                }
              },
            },
            jobLimitMs
          );

          replaceSegmentsInternal(takenOver.recording.id, segments, takenOver.job.epoch);
          processed += 1;
          log(`transkribiert: ${takenOver.recording.id} (${segments.length} Segmente)`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (stopped) {
            // Shutdown: `abort()` hat den Job bereits zurück auf "pending"
            // gesetzt – er soll in der nächsten Nacht weiterlaufen.
            log(`abgebrochen: ${takenOver.recording.id}`);
          } else {
            markJobFailed(takenOver.job.id, message, takenOver.job.epoch);
            failed += 1;
            log(`fehlgeschlagen: ${takenOver.recording.id} – ${message}`);
          }
        } finally {
          currentJobId = null;
        }

        if (stopped) {
          stoppedBy = "shutdown";
          break;
        }
      }
    }
  } catch (error) {
    stoppedBy = "error";
    log(`Lauf abgebrochen: ${(error as Error).message}`);
  } finally {
    if (ownsEngine && engine) await engine.dispose();
    activeEngine = null;
    activeRun = null;
  }

  const summary: RunSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    processed,
    failed,
    stoppedBy,
    skipped,
    triggeredBy: options.triggeredBy,
  };

  // Jeder Lauf landet im Verlauf, auch ein leerer – sonst kann der Admin-Block
  // nicht zeigen, dass die Nacht ohne Arbeit verlief.
  appendRun(summary);
  return summary;
}
