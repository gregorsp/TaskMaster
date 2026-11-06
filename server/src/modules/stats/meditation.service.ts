import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { meditationComments, meditationSessions, users } from "../../db/schema.js";
import { daysBetweenKeys, localDateKey, rangeInfo, shiftDateKey, type ResolvedRange, type StatsRangeInfo } from "./range.js";
import type { StatsScope } from "./types.js";

/**
 * Kennzahlen zur Meditation. `actual_duration_sec` ist der Client-Timer und
 * damit die belastbarste Größe; `planned_duration_sec` liefert die Plan-Treue.
 * Streaks laufen über die Kalendertage mit mindestens einer Session.
 */

export interface MeditationStatsDayPoint {
  date: string;
  sessions: number;
  minutes: number;
  concentration: number | null;
}

export interface MeditationPeriodTotals {
  sessions: number;
  minutes: number;
  avgMinutes: number | null;
  plannedMinutes: number;
  /** Erreichte ÷ geplante Minuten, nur über Sessions mit Plan. */
  adherenceRate: number | null;
  avgConcentration: number | null;
  ratedSessions: number;
  comments: number;
}

export interface MeditationStatsTotals extends MeditationPeriodTotals {
  currentStreak: number;
  bestStreak: number;
}

export interface MeditationStatsPerUser extends MeditationPeriodTotals {
  userId: string;
  displayName: string;
  currentStreak: number;
}

export interface MeditationStats {
  scope: StatsScope;
  range: StatsRangeInfo;
  totals: MeditationStatsTotals;
  previous: MeditationPeriodTotals;
  days: MeditationStatsDayPoint[];
  concentration: { rating: number; count: number }[];
  perUser: MeditationStatsPerUser[] | null;
}

type SessionRow = typeof meditationSessions.$inferSelect;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeStreak(dayKeys: Set<string>, today: string): { current: number; best: number } {
  const sorted = [...dayKeys].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of sorted) {
    run = previous && daysBetweenKeys(previous, key) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    previous = key;
  }

  let current = 0;
  let cursor = dayKeys.has(today) ? today : shiftDateKey(today, -1);
  while (dayKeys.has(cursor)) {
    current += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return { current, best };
}

interface PeriodResult {
  totals: MeditationPeriodTotals;
  days: MeditationStatsDayPoint[];
  concentration: { rating: number; count: number }[];
  /** Kalendertage mit mindestens einer Session – für Streaks. */
  dayKeys: Set<string>;
}

function computePeriod(
  sessions: SessionRow[],
  comments: CommentRow[],
  dayKeys: string[],
  tz: string
): PeriodResult {
  const keySet = new Set(dayKeys);
  const inWindow = sessions.filter((session) => keySet.has(localDateKey(session.startedAt, tz)));
  const commentCount = comments.filter((comment) => keySet.has(localDateKey(comment.createdAt, tz))).length;

  const points = dayKeys.map((date) => ({ date, sessions: 0, minutes: 0, concentration: null as number | null }));
  const byKey = new Map(points.map((point) => [point.date, point]));

  let totalSeconds = 0;
  let plannedSeconds = 0;
  let plannedActualSeconds = 0;
  let ratedTotal = 0;
  const ratingCounts = new Map<number, number>();
  const dayKeysWithSession = new Set<string>();

  for (const session of inWindow) {
    const key = localDateKey(session.startedAt, tz);
    const point = byKey.get(key);
    const seconds = session.actualDurationSec ?? 0;
    totalSeconds += seconds;

    if (session.plannedDurationSec && session.plannedDurationSec > 0) {
      plannedSeconds += session.plannedDurationSec;
      plannedActualSeconds += seconds;
    }

    if (session.concentration !== null) {
      ratedTotal += session.concentration;
      ratingCounts.set(session.concentration, (ratingCounts.get(session.concentration) ?? 0) + 1);
    }

    if (!point) continue;
    point.sessions += 1;
    point.minutes += Math.round(seconds / 60);
    dayKeysWithSession.add(key);
  }

  // Tagesdurchschnitt der Konzentration nachträglich setzen, damit die
  // Reihenfolge der Sessions keine Rolle spielt.
  for (const point of points) {
    const rated = inWindow.filter(
      (session) =>
        localDateKey(session.startedAt, tz) === point.date && session.concentration !== null
    );
    if (rated.length === 0) continue;
    const sum = rated.reduce((total, session) => total + (session.concentration ?? 0), 0);
    point.concentration = round1(sum / rated.length);
  }

  const ratedSessions = [...ratingCounts.values()].reduce((sum, count) => sum + count, 0);

  return {
    totals: {
      sessions: inWindow.length,
      minutes: Math.round(totalSeconds / 60),
      avgMinutes: inWindow.length > 0 ? round1(totalSeconds / 60 / inWindow.length) : null,
      plannedMinutes: Math.round(plannedSeconds / 60),
      adherenceRate: plannedSeconds > 0 ? plannedActualSeconds / plannedSeconds : null,
      avgConcentration: ratedSessions > 0 ? round1(ratedTotal / ratedSessions) : null,
      ratedSessions,
      comments: commentCount,
    },
    days: points,
    concentration: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: ratingCounts.get(rating) ?? 0 })),
    dayKeys: dayKeysWithSession,
  };
}

function loadSessions(from: Date, to: Date, userId?: string): SessionRow[] {
  return getDb()
    .select()
    .from(meditationSessions)
    .where(
      and(
        gte(meditationSessions.startedAt, from),
        lte(meditationSessions.startedAt, to),
        userId ? eq(meditationSessions.userId, userId) : undefined
      )
    )
    .all();
}

type CommentRow = { userId: string; createdAt: Date };

function loadComments(from: Date, to: Date, userId?: string): CommentRow[] {
  return getDb()
    .select({ userId: meditationComments.userId, createdAt: meditationComments.createdAt })
    .from(meditationComments)
    .where(
      and(
        gte(meditationComments.createdAt, from),
        lte(meditationComments.createdAt, to),
        userId ? eq(meditationComments.userId, userId) : undefined
      )
    )
    .all();
}

export function getMeditationStats(options: {
  scope: StatsScope;
  userId: string;
  range: ResolvedRange;
  now?: Date;
}): MeditationStats {
  const now = options.now ?? new Date();
  const filterUser = options.scope === "mine" ? options.userId : undefined;

  const loadFrom =
    options.range.compareStart.getTime() < options.range.start.getTime()
      ? options.range.compareStart
      : options.range.start;

  const sessions = loadSessions(loadFrom, options.range.end, filterUser);
  const comments = loadComments(loadFrom, options.range.end, filterUser);

  const current = computePeriod(sessions, comments, options.range.dayKeys, options.range.tz);
  const previous = computePeriod(sessions, comments, options.range.compareDayKeys, options.range.tz);

  // Streaks brauchen die gesamte Historie, nicht nur das Fenster.
  const allSessions = loadSessions(new Date(0), now, filterUser);
  const allDays = new Set(allSessions.map((session) => localDateKey(session.startedAt, options.range.tz)));
  const today = localDateKey(now, options.range.tz);
  const streak = computeStreak(allDays, today);

  let perUser: MeditationStatsPerUser[] | null = null;
  if (options.scope === "all") {
    const userRows = getDb().select({ id: users.id, displayName: users.displayName }).from(users).all();
    const names = new Map(userRows.map((row) => [row.id, row.displayName]));
    const byUser = new Map<string, SessionRow[]>();
    for (const session of sessions) {
      const list = byUser.get(session.userId) ?? [];
      list.push(session);
      byUser.set(session.userId, list);
    }

    perUser = [...byUser.entries()]
      .map(([id, list]) => {
        const userDays = new Set(
          allSessions
            .filter((session) => session.userId === id)
            .map((session) => localDateKey(session.startedAt, options.range.tz))
        );
        const userStreak = computeStreak(userDays, today);
        const userComments = comments.filter((comment) => comment.userId === id);
        const period = computePeriod(list, userComments, options.range.dayKeys, options.range.tz);
        return {
          userId: id,
          displayName: names.get(id) ?? "—",
          currentStreak: userStreak.current,
          ...period.totals,
        };
      })
      .sort((a, b) => b.minutes - a.minutes);
  }

  return {
    scope: options.scope,
    range: rangeInfo(options.range),
    totals: { ...current.totals, currentStreak: streak.current, bestStreak: streak.best },
    previous: previous.totals,
    days: current.days,
    concentration: current.concentration,
    perUser,
  };
}
