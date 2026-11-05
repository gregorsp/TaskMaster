import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { recordings, transcriptionJobs, users } from "../../db/schema.js";
import { config } from "../../config.js";
import { zonedParts } from "../transcription/server/schedule.js";

/**
 * Kennzahlen zur Audio-Verarbeitung. Grundlage sind ausschließlich Jobs mit
 * `started_at` und `finished_at` – also nur Aufnahmen, die seit Migration 0018
 * gelaufen sind. Alles Ältere hat keine gemessene Dauer und wird bewusst nicht
 * geschätzt (dann lieber leer als erfunden).
 */

export type StatsScope = "mine" | "all";

export interface AudioDayPoint {
  /** Kalendertag in der Zeitzone der Transkription (`YYYY-MM-DD`). */
  date: string;
  done: number;
  failed: number;
  mediaMs: number;
  procMs: number;
}

export interface AudioStatsTotals {
  done: number;
  failed: number;
  /** Summe der Audiolänge aller fertigen Aufnahmen. */
  mediaMs: number;
  /** Summe der gemessenen Bearbeitungszeiten. */
  procMs: number;
  medianProcMs: number | null;
  /** Audiolänge ÷ Bearbeitungszeit; 4 heißt „viermal schneller als Echtzeit". */
  speedup: number | null;
  /** 0 … 1 */
  failureRate: number;
}

export interface AudioStatsPerUser extends AudioStatsTotals {
  userId: string;
  displayName: string;
}

export interface AudioStats {
  scope: StatsScope;
  range: { from: string; to: string; days: number };
  totals: AudioStatsTotals;
  days: AudioDayPoint[];
  /** Nur bei `scope === "all"` gefüllt. */
  perUser: AudioStatsPerUser[] | null;
}

interface FinishedRow {
  status: string;
  userId: string;
  displayName: string;
  mediaMs: number;
  procMs: number | null;
  finishedAt: Date;
}

function dateKey(date: Date): string {
  const parts = zonedParts(date, config.transcriptionTz);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Bearbeitungszeit eines Jobs – nur wenn beide Zeitstempel existieren und plausibel sind. */
function processingMs(startedAt: Date | null, finishedAt: Date | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const ms = finishedAt.getTime() - startedAt.getTime();
  return ms > 0 ? ms : null;
}

function loadRows(from: Date, to: Date, userId?: string): FinishedRow[] {
  const rows = getDb()
    .select({
      status: transcriptionJobs.status,
      userId: transcriptionJobs.userId,
      displayName: users.displayName,
      startedAt: transcriptionJobs.startedAt,
      finishedAt: transcriptionJobs.finishedAt,
      mediaMs: recordings.durationMs,
    })
    .from(transcriptionJobs)
    .innerJoin(recordings, eq(recordings.id, transcriptionJobs.recordingId))
    .innerJoin(users, eq(users.id, transcriptionJobs.userId))
    .where(
      and(
        inArray(transcriptionJobs.status, ["done", "failed"]),
        isNotNull(transcriptionJobs.finishedAt),
        gte(transcriptionJobs.finishedAt, from),
        lte(transcriptionJobs.finishedAt, to),
        userId ? eq(transcriptionJobs.userId, userId) : undefined
      )
    )
    .all();

  return rows.map((row) => ({
    status: row.status,
    userId: row.userId,
    displayName: row.displayName,
    mediaMs: row.mediaMs,
    procMs: processingMs(row.startedAt, row.finishedAt),
    finishedAt: row.finishedAt as Date,
  }));
}

function aggregate(rows: FinishedRow[]): AudioStatsTotals {
  const done = rows.filter((row) => row.status === "done");
  const failed = rows.length - done.length;
  const mediaMs = done.reduce((sum, row) => sum + row.mediaMs, 0);
  const measured = done.filter((row) => row.procMs !== null);
  const procMs = measured.reduce((sum, row) => sum + (row.procMs as number), 0);

  // Echtzeitfaktor je Aufnahme, dann Median: eine einzelne Riesenaufnahme soll
  // den Wert nicht dominieren.
  const perJobSpeedup = measured
    .filter((row) => row.mediaMs > 0 && (row.procMs as number) > 0)
    .map((row) => row.mediaMs / (row.procMs as number));

  return {
    done: done.length,
    failed,
    mediaMs,
    procMs,
    medianProcMs: median(measured.map((row) => row.procMs as number)),
    speedup: median(perJobSpeedup),
    failureRate: rows.length === 0 ? 0 : failed / rows.length,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Kalendertag `offsetDays` Tage vor dem übergebenen Tag – gerechnet im
 * UTC-Namensraum, weil dort keine Sommerzeit existiert und ein Tag garantiert
 * 24 h hat. Der Tag selbst ist der Kalendertag der App-Zeitzone.
 */
function shiftDay(parts: { year: number; month: number; day: number }, offsetDays: number): string {
  const base = Date.UTC(parts.year, parts.month - 1, parts.day);
  const shifted = new Date(base - offsetDays * 24 * 60 * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Kontinuierliche Tagesreihe – auch Tage ohne Aufnahme, sonst lügt die X-Achse. */
function buildDays(rows: FinishedRow[], dayKeys: string[]): AudioDayPoint[] {
  const buckets = new Map<string, AudioDayPoint>();
  const points: AudioDayPoint[] = [];

  for (const key of dayKeys) {
    const point: AudioDayPoint = { date: key, done: 0, failed: 0, mediaMs: 0, procMs: 0 };
    buckets.set(key, point);
    points.push(point);
  }

  for (const row of rows) {
    const point = buckets.get(dateKey(row.finishedAt));
    if (!point) continue; // außerhalb des Rasters (Zeitzonen-Rand)
    if (row.status === "done") {
      point.done += 1;
      point.mediaMs += row.mediaMs;
      point.procMs += row.procMs ?? 0;
    } else {
      point.failed += 1;
    }
  }

  return points;
}

export function getAudioStats(options: {
  scope: StatsScope;
  userId: string;
  days: number;
  now?: Date;
}): AudioStats {
  const now = options.now ?? new Date();
  const parts = zonedParts(now, config.transcriptionTz);
  const dayKeys: string[] = [];
  for (let i = options.days - 1; i >= 0; i -= 1) dayKeys.push(shiftDay(parts, i));

  // Einen Tag früher laden und anschließend über die Tagesschlüssel filtern:
  // die UTC-Grenzen passen nicht exakt auf die Zeitzone, das Raster schon.
  const start = new Date(Date.parse(`${dayKeys[0]}T00:00:00Z`) - 24 * 60 * 60_000);
  const userId = options.scope === "all" ? undefined : options.userId;

  const rows = loadRows(start, now, userId).filter((row) => dayKeys.includes(dateKey(row.finishedAt)));
  const days = buildDays(rows, dayKeys);

  let perUser: AudioStatsPerUser[] | null = null;
  if (options.scope === "all") {
    const byUser = new Map<string, FinishedRow[]>();
    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row);
      byUser.set(row.userId, list);
    }
    perUser = [...byUser.entries()]
      .map(([id, list]) => ({
        userId: id,
        displayName: list[0]?.displayName ?? "—",
        ...aggregate(list),
      }))
      .sort((a, b) => b.mediaMs - a.mediaMs);
  }

  return {
    scope: options.scope,
    range: { from: start.toISOString(), to: now.toISOString(), days: options.days },
    totals: aggregate(rows),
    days,
    perUser,
  };
}

/**
 * Fallback-Rate für die Restzeitschätzung, solange der laufende Job noch keine
 * eigene Messung geliefert hat: Median-Echtzeitfaktor der letzten abgeschlossenen
 * Server-Jobs. Browser-Jobs bleiben draußen – die rechnen auf anderer Hardware.
 */
export function estimatedServerRate(sampleSize = 10): number | null {
  const rows = getDb()
    .select({
      startedAt: transcriptionJobs.startedAt,
      finishedAt: transcriptionJobs.finishedAt,
      mediaMs: recordings.durationMs,
    })
    .from(transcriptionJobs)
    .innerJoin(recordings, eq(recordings.id, transcriptionJobs.recordingId))
    .where(and(eq(transcriptionJobs.status, "done"), eq(transcriptionJobs.engine, "server")))
    .orderBy(desc(transcriptionJobs.finishedAt))
    .limit(sampleSize)
    .all();

  const speedups = rows
    .map((row) => {
      const proc = processingMs(row.startedAt, row.finishedAt);
      return proc && row.mediaMs > 0 ? row.mediaMs / proc : null;
    })
    .filter((value): value is number => value !== null);

  return median(speedups);
}
