import { isModelReady, runTranscriptionJob } from "./transcription";
import { isRecordingActive } from "../audio/recorder";

const ENABLED_KEY = "taskmaster.autoTranscribe";
const IDLE_POLL_MS = 5_000;

export interface RunnerState {
  running: boolean;
  processed: number;
  enabled: boolean;
  lastError: string | null;
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

let enabled = readEnabled();
let state: RunnerState = { running: false, processed: 0, enabled, lastError: null };
const listeners = new Set<(state: RunnerState) => void>();
let started = false;

function emit(): void {
  for (const listener of listeners) listener(state);
}

export function getRunnerState(): RunnerState {
  return state;
}

export function subscribeRunner(listener: (state: RunnerState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function setAutoTranscribe(value: boolean): void {
  enabled = value;
  state = { ...state, enabled: value };
  try {
    localStorage.setItem(ENABLED_KEY, String(value));
  } catch {
    // localStorage kann blockiert sein; dann gilt die Einstellung nur für diese Sitzung.
  }
  emit();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ein Läufer für die ganze App: claimt offene Transkriptions-Jobs und arbeitet
 * sie ab, während man weiterarbeitet. Er pausiert bei laufender Aufnahme und
 * wenn der Tab unsichtbar ist (dann rechnet der Browser ohnehin gedrosselt).
 */
async function loop(): Promise<void> {
  while (started) {
    if (!enabled || document.hidden || isRecordingActive()) {
      await sleep(IDLE_POLL_MS);
      continue;
    }

    let ready = false;
    try {
      ready = await isModelReady();
    } catch {
      ready = false;
    }
    if (!ready) {
      await sleep(30_000);
      continue;
    }

    if (!state.running) {
      state = { ...state, running: true };
      emit();
    }

    try {
      const worked = await runTranscriptionJob();
      if (worked) {
        state = { ...state, processed: state.processed + 1, lastError: null };
        emit();
        window.dispatchEvent(new Event("taskmaster:transcription-done"));
      } else {
        state = { ...state, running: false };
        emit();
        await sleep(IDLE_POLL_MS);
      }
    } catch (error) {
      state = { ...state, running: false, lastError: String(error) };
      emit();
      await sleep(15_000);
    }
  }
}

export function startTranscriptionRunner(): void {
  if (started) return;
  started = true;

  const locks = (
    navigator as Navigator & {
      locks?: {
        request: (name: string, options: { mode: string }, callback: () => Promise<void>) => Promise<void>;
      };
    }
  ).locks;

  if (locks?.request) {
    // Nur ein Tab rechnet; der andere übernimmt, sobald der erste geschlossen ist.
    void locks.request("taskmaster-transcription", { mode: "exclusive" }, loop).catch(() => {
      started = false;
    });
  } else {
    void loop();
  }
}

export function stopTranscriptionRunner(): void {
  started = false;
  state = { ...state, running: false };
  emit();
}
