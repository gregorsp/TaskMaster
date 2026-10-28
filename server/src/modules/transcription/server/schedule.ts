/**
 * Zeitplan des nächtlichen Server-Laufs.
 *
 * Bewusst ohne `node-cron` und ohne Abhängigkeit von der Zeitzone des
 * Containers (Docker läuft standardmäßig in UTC): "nachts um 3" heißt 03:00 in
 * `config.transcriptionTz`, berechnet über `Intl.DateTimeFormat`.
 *
 * Die Umrechnung von Wandzeit nach UTC läuft in zwei Schritten (Schätzung,
 * dann Korrektur mit dem Offset am geschätzten Zeitpunkt). Für 03:00 reicht
 * das auch an den DST-Grenzen, weil Europa/Berlin um 02:00 bzw. 03:00
 * umschaltet – die Stunde 03:00 ist nie doppelt und nie ausgelassen.
 */

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // "24" kommt bei hour12: false um Mitternacht vor.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset der Zeitzone zu UTC in ms zum gegebenen Zeitpunkt (Ost positiv). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const base = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - base;
}

/** Wandzeit in der Zeitzone → echter Zeitpunkt (UTC). */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = zoneOffsetMs(new Date(guess), timeZone);
  const corrected = guess - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(corrected), timeZone);
  return new Date(guess - secondOffset);
}

export function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

/** Nächster Zeitpunkt `at` (HH:MM) in `timeZone`, strikt nach `now`. */
export function nextRunAt(now: Date, at: string, timeZone: string): Date {
  const { hour, minute } = parseTimeOfDay(at);
  const today = zonedParts(now, timeZone);
  const candidate = zonedTimeToInstant(today.year, today.month, today.day, hour, minute, timeZone);
  if (candidate.getTime() > now.getTime()) return candidate;

  const tomorrowUtc = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return zonedTimeToInstant(
    tomorrowUtc.getUTCFullYear(),
    tomorrowUtc.getUTCMonth() + 1,
    tomorrowUtc.getUTCDate(),
    hour,
    minute,
    timeZone
  );
}

/** Minuten seit Mitternacht in der Zeitzone. */
export function minutesOfDay(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}

/** Kalendertag (YYYY-MM-DD) in der Zeitzone – für "heute schon gelaufen?". */
export function zonedDateKey(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/**
 * Beim Start nachholen, wenn der Lauf heute noch nicht stattgefunden hat und
 * die Uhrzeit zwischen `at` und `catchUpUntil` liegt. Ein Container, der um
 * 03:00 aus war und um 05:00 startet, holt den Lauf also nach; einer, der um
 * 09:00 startet, wartet auf die nächste Nacht.
 */
export function shouldCatchUp(
  now: Date,
  at: string,
  catchUpUntil: string,
  timeZone: string,
  lastRunAt: Date | null
): boolean {
  if (lastRunAt && zonedDateKey(lastRunAt, timeZone) === zonedDateKey(now, timeZone)) return false;

  const start = parseTimeOfDay(at);
  const end = parseTimeOfDay(catchUpUntil);
  const nowMinutes = minutesOfDay(now, timeZone);
  return nowMinutes >= start.hour * 60 + start.minute && nowMinutes <= end.hour * 60 + end.minute;
}
