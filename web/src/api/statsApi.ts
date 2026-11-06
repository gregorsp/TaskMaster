import client from "./client";
import type { AudioScope } from "./audioApi";

/** Gemeinsame Zeitraum-/Scope-Typen für alle Statistik-Endpoints. */
export type StatsScope = AudioScope;
export type StatsRangePreset = "7d" | "30d" | "90d" | "week" | "month" | "quarter" | "custom";

export interface StatsRangeSelection {
  preset: StatsRangePreset;
  from?: string;
  to?: string;
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

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function rangeParams(range: StatsRangeSelection): Record<string, string> {
  const params: Record<string, string> = { range: range.preset };
  if (range.preset === "custom" && range.from && range.to) {
    params.from = range.from;
    params.to = range.to;
  }
  const tz = browserTimeZone();
  if (tz) params.tz = tz;
  return params;
}

/* ---------------------------------------------------------------- Aufgaben */

export type TaskStatsLens = "created" | "assigned" | "completed";

export interface TaskStatsDayPoint {
  date: string;
  completed: number;
  created: number;
  onTime: number;
  late: number;
}

export interface TaskStatsTotals {
  completed: number;
  created: number;
  onTime: number;
  late: number;
  withoutDeadline: number;
  onTimeRate: number | null;
  open: number | null;
  overdue: number | null;
  openWithoutDue: number | null;
}

export interface TaskStatsPerUser extends TaskStatsTotals {
  userId: string;
  displayName: string;
}

export interface TaskCategoryBucket {
  id: string | null;
  name: string;
  color: string;
  count: number;
}

export interface TaskStatsDistributions {
  tasks: number;
  categories: TaskCategoryBucket[];
  importance: { important: number; normal: number };
  quadrants: { do: number; plan: number; delegate: number; drop: number };
}

export interface HabitStatsItem {
  taskId: string;
  title: string;
  createdAt: string;
  completedDays: number;
  expectedDays: number;
  rate: number | null;
  currentStreak: number;
  bestStreak: number;
}

export interface HabitStatsTotals {
  habits: number;
  completedDays: number;
  expectedDays: number;
  rate: number | null;
  currentStreak: number;
  bestStreak: number;
}

export interface HabitStatsPerUser extends HabitStatsTotals {
  userId: string;
  displayName: string;
}

export interface HabitStats {
  overall: HabitStatsTotals;
  items: HabitStatsItem[] | null;
  perUser: HabitStatsPerUser[] | null;
}

export interface TaskStats {
  scope: StatsScope;
  lens: TaskStatsLens;
  range: StatsRangeInfo;
  totals: TaskStatsTotals;
  previous: TaskStatsTotals;
  days: TaskStatsDayPoint[];
  distributions: TaskStatsDistributions;
  habits: HabitStats;
  perUser: TaskStatsPerUser[] | null;
}

export async function getTaskStats(
  scope: StatsScope,
  lens: TaskStatsLens,
  range: StatsRangeSelection
): Promise<TaskStats> {
  const { data } = await client.get<TaskStats>("/stats/tasks", { params: { scope, lens, ...rangeParams(range) } });
  return data;
}

/* -------------------------------------------------------------- Meditation */

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

export async function getMeditationStats(
  scope: StatsScope,
  range: StatsRangeSelection
): Promise<MeditationStats> {
  const { data } = await client.get<MeditationStats>("/stats/meditation", {
    params: { scope, ...rangeParams(range) },
  });
  return data;
}

/* ------------------------------------------------------------------- Audio */

export interface AudioDayPoint {
  date: string;
  done: number;
  failed: number;
  mediaMs: number;
  procMs: number;
}

export interface AudioStatsTotals {
  done: number;
  failed: number;
  mediaMs: number;
  procMs: number;
  medianProcMs: number | null;
  /** Audiolänge ÷ Bearbeitungszeit; 4 = viermal schneller als Echtzeit. */
  speedup: number | null;
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
  perUser: AudioStatsPerUser[] | null;
}

export async function getAudioStats(scope: StatsScope, range: StatsRangeSelection): Promise<AudioStats> {
  const { data } = await client.get<AudioStats>("/stats/audio", { params: { scope, ...rangeParams(range) } });
  return data;
}
