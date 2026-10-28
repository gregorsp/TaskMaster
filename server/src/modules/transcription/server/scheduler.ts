import { config } from "../../../config.js";
import { sweepStaleJobs } from "../../recordings/recordings.service.js";
import { readLastRun, writeNextRun } from "./runlog.js";
import { nextRunAt, shouldCatchUp } from "./schedule.js";
import { abortTranscriptionRun, isTranscriptionRunActive, runTranscriptionBatch } from "./runner.js";

/**
 * Zeitsteuerung des nächtlichen Laufs.
 *
 * Kein `node-cron`: ein einzelnes `setTimeout` auf den nächsten 3-Uhr-Punkt in
 * `config.transcriptionTz` reicht, ist DST-fest und lässt sich testen. Nach
 * jedem Lauf wird der nächste Termin neu berechnet, damit eine lange Nacht den
 * Rhythmus nicht verschiebt.
 */

/** Bis zu dieser Uhrzeit wird ein verpasster Lauf beim Start nachgeholt. */
export const CATCH_UP_UNTIL = "06:00";

/** Aufräumen hängender Jobs – unabhängig von der Server-Transkription. */
const SWEEP_INTERVAL_MS = 60 * 60_000;

let runTimer: NodeJS.Timeout | null = null;
let sweepTimer: NodeJS.Timeout | null = null;

type Logger = (message: string) => void;

function runSweep(log: Logger): void {
  try {
    const swept = sweepStaleJobs();
    if (swept.released > 0) log(`${swept.released} hängende Transkriptions-Jobs wieder freigegeben`);
  } catch (error) {
    log(`Aufräumen fehlgeschlagen: ${(error as Error).message}`);
  }
}

function scheduleNext(log: Logger): void {
  if (runTimer) clearTimeout(runTimer);
  const next = nextRunAt(new Date(), config.transcribeAt, config.transcriptionTz);
  writeNextRun(next);
  log(`Nächster Lauf: ${next.toISOString()}`);

  runTimer = setTimeout(() => {
    runTimer = null;
    void execute("schedule", log);
  }, Math.max(0, next.getTime() - Date.now()));
  runTimer.unref();
}

async function execute(triggeredBy: "schedule" | "catchup", log: Logger): Promise<void> {
  if (isTranscriptionRunActive()) {
    log("Lauf übersprungen – es läuft bereits einer");
  } else {
    try {
      const summary = await runTranscriptionBatch({ triggeredBy, log });
      log(
        `Lauf beendet: ${summary.processed} transkribiert, ${summary.failed} fehlgeschlagen` +
          (summary.skipped ? `, übersprungen (${summary.skipped})` : "") +
          (summary.stoppedBy ? `, gestoppt (${summary.stoppedBy})` : "")
      );
    } catch (error) {
      log(`Lauf fehlgeschlagen: ${(error as Error).message}`);
    }
  }
  scheduleNext(log);
}

export function startTranscriptionScheduler(log: Logger = console.log): void {
  runSweep(log);
  sweepTimer = setInterval(() => runSweep(log), SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  if (!config.transcribeServer) {
    log(
      "Server-Transkription ist aus (TRANSCRIBE_SERVER=true schaltet sie ein). " +
        "Aufräumen hängender Jobs läuft weiter."
    );
    return;
  }

  if (isTranscriptionRunActive()) return;

  const lastRun = readLastRun();
  const catchUp = shouldCatchUp(
    new Date(),
    config.transcribeAt,
    CATCH_UP_UNTIL,
    config.transcriptionTz,
    lastRun ? new Date(lastRun.startedAt) : null
  );

  if (catchUp) {
    log(`Verpasster Lauf wird nachgeholt (${config.transcribeAt} ${config.transcriptionTz})`);
    void execute("catchup", log);
    return;
  }

  scheduleNext(log);
}

export function stopTranscriptionScheduler(): void {
  if (runTimer) clearTimeout(runTimer);
  if (sweepTimer) clearInterval(sweepTimer);
  runTimer = null;
  sweepTimer = null;
  abortTranscriptionRun();
}
