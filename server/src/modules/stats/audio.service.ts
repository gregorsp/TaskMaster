import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { recordings, transcriptionJobs, users } from "../../db/schema.js";
import { zonedDateKey } from "../transcription/server/schedule.js";
import { rangeInfo, type ResolvedRange, type StatsRangeInfo } from "./range.js";
import type { StatsScope } from "./types.js";

/**
 * Kennzahlen zur Audio-Verarbeitung. Grundlage sind ausschließlich Jobs mit
 * `started_at` und `finished_at` – also nur Aufnahmen, die seit Migration 0018
 * gelaufen sind. Alles Ältere hat keine gemessene Dauer und wird bewusst nicht
 * geschätzt (dann lieber leer als erfunden).
 */

export interface AudioDayPoint {
  /** Kalendertag in der angefragten Zeitzone (`YYYY-MM-DD`). */
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

export interface AudioEngineStats extends AudioStatsTotals {
  engine: string;
}

export interface AudioStats {
  scope: StatsScope;
  range: StatsRangeInfo;
  totals: AudioStatsTotals;
  previous: AudioStatsTotals;
  byEngine: AudioEngineStats[];
  days: AudioDayPoint[];
  /** Nur bei `scope === "all"` gefüllt. */
  perUser: AudioStatsPerUser[] | null;
}

interface FinishedRow {
  status: string;
  userId: string;
  displayName: string;
  engine: string | null;
  mediaMs: number;
  procMs: number | null;
  finishedAt: Date;
}

function dateKey(date: Date, tz: string): string {
  return zonedDateKey(date, tz);
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
      engine: transcriptionJobs.engine,
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
    engine: row.engine,
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

/** Kontinuierliche Tagesreihe – auch Tage ohne Aufnahme, sonst lügt die X-Achse. */
function buildDays(rows: FinishedRow[], dayKeys: string[], tz: string): AudioDayPoint[] {
  const buckets = new Map<string, AudioDayPoint>();
  const points: AudioDayPoint[] = [];

  for (const key of dayKeys) {
    const point: AudioDayPoint = { date: key, done: 0, failed: 0, mediaMs: 0, procMs: 0 };
    buckets.set(key, point);
    points.push(point);
  }

  for (const row of rows) {
    const point = buckets.get(dateKey(row.finishedAt, tz));
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

function groupByEngine(rows: FinishedRow[]): AudioEngineStats[] {
  const groups = new Map<string, FinishedRow[]>();
  for (const row of rows) {
    const key = row.engine ?? "unknown";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const order = ["server", "device", "unknown"];
  return [...groups.entries()]
    .sort((a, b) => {
      const aIndex = order.indexOf(a[0]);
      const bIndex = order.indexOf(b[0]);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    })
    .map(([engine, list]) => ({ engine, ...aggregate(list) }));
}

export function getAudioStats(options: {
  scope: StatsScope;
  userId: string;
  range: ResolvedRange;
}): AudioStats {
  const { range } = options;
  const userId = options.scope === "all" ? undefined : options.userId;

  const currentRows = loadRows(range.start, range.end, userId).filter((row) =>
    range.dayKeys.includes(dateKey(row.finishedAt, range.tz))
  );
  const previousRows = loadRows(range.compareStart, range.compareEnd, userId).filter((row) =>
    range.compareDayKeys.includes(dateKey(row.finishedAt, range.tz))
  );

  let perUser: AudioStatsPerUser[] | null = null;
  if (options.scope === "all") {
    const byUser = new Map<string, FinishedRow[]>();
    for (const row of currentRows) {
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
    range: rangeInfo(range),
    totals: aggregate(currentRows),
    previous: aggregate(previousRows),
    byEngine: groupByEngine(currentRows),
    days: buildDays(currentRows, range.dayKeys, range.tz),
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
