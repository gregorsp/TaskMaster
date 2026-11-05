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

/**
 * Live-Zustand des laufenden Durchgangs. Bewusst im Speicher und nicht in der
 * DB: es geht um „was passiert gerade", und ein Neustart macht den Zustand
 * ohnehin ungültig.
 */
export interface RunStatusSnapshot {
  startedAt: string;
  triggeredBy: RunSummary["triggeredBy"];
  totalJobs: number;
  /** Summe der Audiodauer aller Jobs, die beim Start in der Warteschlange lagen. */
  totalMediaMs: number;
  doneJobs: number;
  doneMediaMs: number;
  current: {
    jobId: string;
    recordingId: string;
    userId: string;
    durationMs: number;
    progressMs: number;
  } | null;
  /** Audiolänge pro Wanduhr-Millisekunde; 1 = Echtzeit, 4 = viermal schneller. */
  rate: number | null;
}

let runStatus: RunStatusSnapshot | null = null;

/** `null`, wenn gerade kein Durchgang läuft. */
export function getRunStatus(): RunStatusSnapshot | null {
  return runStatus;
}

/**
 * Wie lange mindestens zwischen zwei Messpunkten liegen muss, bevor daraus eine
 * Rate wird. Der Decoder meldet Fortschritt alle ~2 s Audio; über 15 s Wanduhr
 * mittelt sich der JIT-/Speicher-Jitter des ersten Chunks heraus.
 */
const RATE_WINDOW_MS = 15_000;
const RATE_MIN = 0.02;
const RATE_MAX = 200;

function nextRateSample(
  progressMs: number,
  sample: { progressMs: number; at: number } | null
): { progressMs: number; at: number } {
  const now = Date.now();
  if (!sample) return { progressMs, at: now };
  const dt = now - sample.at;
  if (dt < RATE_WINDOW_MS) return sample;
  if (progressMs <= sample.progressMs) {
    // Kein echter Fortschritt (Pause, Retry im selben Job): Messpunkt neu setzen,
    // ohne die bisherige Rate zu verwerfen.
    return { progressMs, at: now };
  }
  if (runStatus) {
    const instant = (progressMs - sample.progressMs) / dt;
    const clamped = Math.min(RATE_MAX, Math.max(RATE_MIN, instant));
    runStatus.rate = runStatus.rate === null ? clamped : runStatus.rate * 0.5 + clamped * 0.5;
  }
  return { progressMs, at: now };
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

      // Snapshot für die Fortschrittsanzeige: Nennermenge bleibt der Stand von
      // Laufbeginn, damit der Balken nicht durch nachrückende Jobs springt.
      runStatus = {
        startedAt: startedAt.toISOString(),
        triggeredBy: options.triggeredBy,
        totalJobs: queue.length,
        totalMediaMs: queue.reduce((sum, entry) => sum + (entry.recording.durationMs || 0), 0),
        doneJobs: 0,
        doneMediaMs: 0,
        current: null,
        rate: null,
      };

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
        let rateSample: { progressMs: number; at: number } | null = null;
        if (runStatus) {
          runStatus.current = {
            jobId: takenOver.job.id,
            recordingId: takenOver.recording.id,
            userId: takenOver.job.userId,
            durationMs: takenOver.recording.durationMs,
            progressMs: 0,
          };
        }

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
                if (runStatus?.current && runStatus.current.jobId === takenOver.job.id) {
                  runStatus.current.progressMs = progressMs;
                  rateSample = nextRateSample(progressMs, rateSample);
                }
              },
            },
            jobLimitMs
          );

          replaceSegmentsInternal(takenOver.recording.id, segments, takenOver.job.epoch);
          processed += 1;
          if (runStatus) {
            runStatus.doneJobs += 1;
            runStatus.doneMediaMs += takenOver.recording.durationMs;
          }
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
          if (runStatus) runStatus.current = null;
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
    runStatus = null;
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
