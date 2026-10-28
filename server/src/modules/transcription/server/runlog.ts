import { eq } from "drizzle-orm";
import { getDb } from "../../../db/client.js";
import { appMeta } from "../../../db/schema.js";

/**
 * Verlauf der nächtlichen Läufe, gespeichert in `app_meta` – bewusst ohne
 * eigenes Schema, weil es nur Anzeige-Daten für den Admin-Block sind.
 */
export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  processed: number;
  failed: number;
  /** Warum der Lauf nicht alle Jobs erledigt hat ("budget", "deadline", "shutdown", "error"). */
  stoppedBy: string | null;
  /** Grund, warum gar nicht gestartet wurde (kein Modell, kein Internet, …). */
  skipped: string | null;
  triggeredBy: "schedule" | "catchup" | "admin";
}

const KEY_LAST_RUN = "transcription_server_last_run";
const KEY_RUNS = "transcription_server_runs";
const KEY_NEXT_RUN = "transcription_server_next_run";
const MAX_RUNS = 10;

function readValue(key: string): string | null {
  try {
    return getDb().select({ value: appMeta.value }).from(appMeta).where(eq(appMeta.key, key)).get()?.value ?? null;
  } catch {
    return null;
  }
}

function writeValue(key: string, value: string): void {
  getDb()
    .insert(appMeta)
    .values({ key, value })
    .onConflictDoUpdate({ target: appMeta.key, set: { value } })
    .run();
}

export function readRunHistory(): RunSummary[] {
  const raw = readValue(KEY_RUNS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RunSummary[]) : [];
  } catch {
    return [];
  }
}

export function readLastRun(): RunSummary | null {
  const raw = readValue(KEY_LAST_RUN);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RunSummary;
  } catch {
    return null;
  }
}

export function appendRun(summary: RunSummary): void {
  const history = [summary, ...readRunHistory()].slice(0, MAX_RUNS);
  writeValue(KEY_RUNS, JSON.stringify(history));
  writeValue(KEY_LAST_RUN, JSON.stringify(summary));
}

export function readNextRun(): string | null {
  return readValue(KEY_NEXT_RUN);
}

export function writeNextRun(instant: Date | null): void {
  writeValue(KEY_NEXT_RUN, instant ? instant.toISOString() : "");
}
