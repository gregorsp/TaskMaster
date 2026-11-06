import { config } from "../../config.js";
import { zonedDateKey, zonedTimeToInstant } from "../transcription/server/schedule.js";

/**
 * Gemeinsames Zeitraum-Modell für alle Statistik-Endpoints.
 *
 * Die Tagesgrenzen liegen in der Zeitzone des Browsers (`tz`), nicht in der
 * Server-Zeitzone – Docker läuft UTC, das wäre für „was habe ich heute
 * geschafft“ schlicht falsch. Fehlt der Parameter, gilt die konfigurierte
 * App-Zeitzone (dieselbe, in der der Nachtlauf rechnet).
 */

export type StatsRangePreset = "7d" | "30d" | "90d" | "week" | "month" | "quarter" | "custom";

const PRESETS: StatsRangePreset[] = ["7d", "30d", "90d", "week", "month", "quarter", "custom"];
const MAX_DAYS = 366;
const DAY_MS = 86_400_000;

export interface StatsRangeQuery {
  range?: string;
  from?: string;
  to?: string;
  tz?: string;
}

export interface StatsRangeInfo {
  preset: StatsRangePreset;
  from: string;
  to: string;
  days: number;
  tz: string;
  compareFrom: string;
  compareTo: string;
}

export interface ResolvedRange extends StatsRangeInfo {
  dayKeys: string[];
  start: Date;
  end: Date;
  compareDayKeys: string[];
  compareStart: Date;
  compareEnd: Date;
}

function fail(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400, code: "INVALID_RANGE" });
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function keyToUtc(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function utcToKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Kalendertag verschieben – im UTC-Namensraum, damit ein Tag immer 24 h hat. */
export function shiftDateKey(key: string, offsetDays: number): string {
  return utcToKey(keyToUtc(key) + offsetDays * DAY_MS);
}

export function daysBetweenKeys(from: string, to: string): number {
  return Math.round((keyToUtc(to) - keyToUtc(from)) / DAY_MS);
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return utcToKey(keyToUtc(value)) === value;
}

function dayKeysBetween(from: string, to: string): string[] {
  const keys: string[] = [];
  const count = daysBetweenKeys(from, to);
  for (let index = 0; index <= count; index += 1) keys.push(shiftDateKey(from, index));
  return keys;
}

function weekday(key: string): number {
  return new Date(keyToUtc(key)).getUTCDay();
}

function mondayOf(key: string): string {
  return shiftDateKey(key, -((weekday(key) + 6) % 7));
}

function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

function shiftMonths(key: string, months: number): string {
  const [year, month] = key.split("-").map(Number);
  const total = year * 12 + (month - 1) + months;
  return `${Math.floor(total / 12)}-${pad2(((total % 12) + 12) % 12 + 1)}-01`;
}

function quarterStart(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${year}-${pad2(Math.floor((month - 1) / 3) * 3 + 1)}-01`;
}

export function assertTimeZone(timeZone: string): void {
  if (!timeZone || timeZone.length > 64) fail("Ungültige Zeitzone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    fail(`Unbekannte Zeitzone: ${timeZone}`);
  }
}

export function localDayStart(key: string, tz: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return zonedTimeToInstant(year, month, day, 0, 0, tz);
}

export function localDayEnd(key: string, tz: string): Date {
  return new Date(localDayStart(shiftDateKey(key, 1), tz).getTime() - 1);
}

export function localDateKey(instant: Date, tz: string): string {
  return zonedDateKey(instant, tz);
}

export function resolveRange(query: StatsRangeQuery, now = new Date()): ResolvedRange {
  const preset = (query.range ?? "30d") as StatsRangePreset;
  if (!PRESETS.includes(preset)) fail(`Unbekannter Zeitraum: ${query.range}`);

  const tz = (query.tz ?? "").trim() || config.transcriptionTz;
  assertTimeZone(tz);

  const today = zonedDateKey(now, tz);
  let from: string;
  let to: string;

  if (preset === "custom") {
    if (!query.from || !query.to) fail("Für einen eigenen Zeitraum werden von und bis benötigt");
    if (!isDateKey(query.from) || !isDateKey(query.to)) fail("Datum muss im Format JJJJ-MM-TT vorliegen");
    from = query.from;
    to = query.to;
    if (from > to) fail("Der Zeitraum beginnt nach seinem Ende");
    if (to > today) fail("Der Zeitraum liegt in der Zukunft");
    if (daysBetweenKeys(from, to) + 1 > MAX_DAYS) {
      fail(`Der Zeitraum darf höchstens ${MAX_DAYS} Tage umfassen`);
    }
  } else if (preset === "week") {
    from = mondayOf(today);
    to = today;
  } else if (preset === "month") {
    from = monthStart(today);
    to = today;
  } else if (preset === "quarter") {
    from = quarterStart(today);
    to = today;
  } else {
    const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
    from = shiftDateKey(today, -(days - 1));
    to = today;
  }

  const dayKeys = dayKeysBetween(from, to);

  let compareFrom: string;
  let compareTo: string;
  if (preset === "week" || preset === "month" || preset === "quarter") {
    const previousStart =
      preset === "week" ? shiftDateKey(from, -7) : shiftMonths(from, preset === "month" ? -1 : -3);
    compareFrom = previousStart;
    const naturalEnd = shiftDateKey(previousStart, dayKeys.length - 1);
    const previousEnd = shiftDateKey(from, -1);
    compareTo = naturalEnd < previousEnd ? naturalEnd : previousEnd;
  } else {
    compareTo = shiftDateKey(from, -1);
    compareFrom = shiftDateKey(compareTo, -(dayKeys.length - 1));
  }

  const compareDayKeys = dayKeysBetween(compareFrom, compareTo);

  return {
    preset,
    tz,
    from,
    to,
    days: dayKeys.length,
    dayKeys,
    start: localDayStart(from, tz),
    // Ein laufender Tag endet jetzt, ein abgeschlossener am Tagesende.
    end: to === today ? now : localDayEnd(to, tz),
    compareFrom,
    compareTo,
    compareDayKeys,
    compareStart: localDayStart(compareFrom, tz),
    compareEnd: localDayEnd(compareTo, tz),
  };
}

export function rangeInfo(range: ResolvedRange): StatsRangeInfo {
  return {
    preset: range.preset,
    from: range.from,
    to: range.to,
    days: range.days,
    tz: range.tz,
    compareFrom: range.compareFrom,
    compareTo: range.compareTo,
  };
}
