import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  categories,
  taskAssignees,
  taskCategories,
  taskEvents,
  taskOccurrences,
  tasks,
  users,
} from "../../db/schema.js";
import { computeIsUrgent, isTaskOverdue, type TaskLike } from "../calendar/recurrence.service.js";
import {
  daysBetweenKeys,
  localDateKey,
  localDayEnd,
  rangeInfo,
  shiftDateKey,
  type ResolvedRange,
  type StatsRangeInfo,
} from "./range.js";
import type { StatsScope } from "./types.js";

/**
 * Kennzahlen zu Aufgaben. Alles wird aus den vorhandenen Tabellen gelesen –
 * es gibt keine Snapshots und keinen Änderungs-Log, deshalb sind Pünktlichkeit
 * und Habit-Quote bewusst als Schätzung gekennzeichnet.
 */

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
  /** Erledigt, aber ohne bewertbare Frist (keine Frist oder Occurrence-Datum fehlt). */
  withoutDeadline: number;
  onTimeRate: number | null;
  /** Nur bei `lens === "assigned"` gefüllt. */
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

type TaskRow = typeof tasks.$inferSelect;
type EventRow = typeof taskEvents.$inferSelect;
type OccurrenceRow = typeof taskOccurrences.$inferSelect;

interface CategoryRow {
  taskId: string;
  id: string;
  name: string;
  color: string;
}

interface StatsData {
  tasks: TaskRow[];
  events: EventRow[];
  occurrences: OccurrenceRow[];
  assignees: Map<string, string[]>;
  categoriesByTask: Map<string, CategoryRow[]>;
  users: Map<string, string>;
}

interface StatsWindow {
  dayKeys: string[];
  keySet: Set<string>;
  events: EventRow[];
  createdTasks: TaskRow[];
}

interface WindowResult {
  totals: TaskStatsTotals;
  days: TaskStatsDayPoint[];
  distributions: TaskStatsDistributions;
}

function loadData(from: Date, to: Date): StatsData {
  const db = getDb();

  const taskRows = db.select().from(tasks).all();
  const eventRows = db
    .select()
    .from(taskEvents)
    .where(
      and(eq(taskEvents.type, "completed"), gte(taskEvents.createdAt, from), lte(taskEvents.createdAt, to))
    )
    .all();
  const occurrenceRows = db
    .select()
    .from(taskOccurrences)
    .where(eq(taskOccurrences.isCompleted, true))
    .all();
  const assigneeRows = db.select().from(taskAssignees).all();
  const categoryRows = db
    .select({
      taskId: taskCategories.taskId,
      id: categories.id,
      name: categories.name,
      color: categories.color,
    })
    .from(taskCategories)
    .innerJoin(categories, eq(categories.id, taskCategories.categoryId))
    .all();
  const userRows = db.select({ id: users.id, displayName: users.displayName }).from(users).all();

  const assignees = new Map<string, string[]>();
  for (const row of assigneeRows) {
    const list = assignees.get(row.taskId) ?? [];
    list.push(row.userId);
    assignees.set(row.taskId, list);
  }

  const categoriesByTask = new Map<string, CategoryRow[]>();
  for (const row of categoryRows) {
    const list = categoriesByTask.get(row.taskId) ?? [];
    list.push(row);
    categoriesByTask.set(row.taskId, list);
  }

  return {
    tasks: taskRows,
    events: eventRows,
    occurrences: occurrenceRows,
    assignees,
    categoriesByTask,
    users: new Map(userRows.map((row) => [row.id, row.displayName])),
  };
}

function buildWindow(data: StatsData, range: ResolvedRange, mode: "current" | "previous"): StatsWindow {
  const dayKeys = mode === "current" ? range.dayKeys : range.compareDayKeys;
  const keySet = new Set(dayKeys);
  const events = data.events.filter((event) => keySet.has(localDateKey(event.createdAt, range.tz)));
  const createdTasks = data.tasks.filter((task) => keySet.has(localDateKey(task.createdAt, range.tz)));
  return { dayKeys, keySet, events, createdTasks };
}

function taskLike(task: TaskRow): TaskLike {
  return {
    recurrenceType: task.recurrenceType,
    recurrenceRule: task.recurrenceRule,
    dueAt: task.dueAt,
    baseDate: task.baseDate,
    lastCompletedAt: task.lastCompletedAt,
    isCompleted: task.isCompleted,
    urgencyMode: task.urgencyMode,
    urgencyValue: task.urgencyValue,
    createdAt: task.createdAt,
  };
}

function deadlineEnd(event: EventRow, task: TaskRow, tz: string): Date | null {
  if (event.occurrenceDate) return localDayEnd(localDateKey(event.occurrenceDate, tz), tz);
  // Eine wiederkehrende Aufgabe ohne Occurrence-Datum lässt sich keiner Frist
  // zuordnen – sie zählt als erledigt, aber nicht in die Pünktlichkeitsquote.
  if (task.recurrenceType === "rrule") return null;
  if (!task.dueAt) return null;
  return localDayEnd(localDateKey(task.dueAt, tz), tz);
}

function buildDays(
  window: StatsWindow,
  events: EventRow[],
  createdTasks: TaskRow[],
  taskById: Map<string, TaskRow>,
  tz: string
): { days: TaskStatsDayPoint[]; onTime: number; late: number; withoutDeadline: number } {
  const points = window.dayKeys.map((date) => ({ date, completed: 0, created: 0, onTime: 0, late: 0 }));
  const byKey = new Map(points.map((point) => [point.date, point]));
  let onTime = 0;
  let late = 0;
  let withoutDeadline = 0;

  for (const event of events) {
    const key = localDateKey(event.createdAt, tz);
    const point = byKey.get(key);
    if (!point) continue;
    point.completed += 1;

    const task = taskById.get(event.taskId);
    const deadline = task ? deadlineEnd(event, task, tz) : null;
    if (!deadline) {
      withoutDeadline += 1;
      continue;
    }
    if (event.createdAt.getTime() <= deadline.getTime()) {
      point.onTime += 1;
      onTime += 1;
    } else {
      point.late += 1;
      late += 1;
    }
  }

  for (const task of createdTasks) {
    const point = byKey.get(localDateKey(task.createdAt, tz));
    if (point) point.created += 1;
  }

  return { days: points, onTime, late, withoutDeadline };
}

function buildDistributions(
  population: TaskRow[],
  data: StatsData
): TaskStatsDistributions {
  const seen = new Set<string>();
  const unique: TaskRow[] = [];
  for (const task of population) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    unique.push(task);
  }

  const categoryCounts = new Map<string, TaskCategoryBucket>();
  let uncategorized = 0;
  for (const task of unique) {
    const list = data.categoriesByTask.get(task.id) ?? [];
    if (list.length === 0) uncategorized += 1;
    for (const category of list) {
      const bucket = categoryCounts.get(category.id) ?? {
        id: category.id,
        name: category.name,
        color: category.color,
        count: 0,
      };
      bucket.count += 1;
      categoryCounts.set(category.id, bucket);
    }
  }

  const categories = [...categoryCounts.values()].sort((a, b) => b.count - a.count);
  if (uncategorized > 0) {
    categories.push({ id: null, name: "Ohne Kategorie", color: "#9e9e9e", count: uncategorized });
  }

  let important = 0;
  const quadrants = { do: 0, plan: 0, delegate: 0, drop: 0 };
  for (const task of unique) {
    if (task.isImportant) important += 1;
    const urgent = computeIsUrgent(taskLike(task));
    if (task.isImportant && urgent) quadrants.do += 1;
    else if (task.isImportant) quadrants.plan += 1;
    else if (urgent) quadrants.delegate += 1;
    else quadrants.drop += 1;
  }

  return {
    tasks: unique.length,
    categories,
    importance: { important, normal: unique.length - important },
    quadrants,
  };
}

function computeWindow(
  data: StatsData,
  window: StatsWindow,
  tz: string,
  lens: TaskStatsLens,
  ownerId: string | null,
  includeCurrentState: boolean
): WindowResult {
  const taskById = new Map(data.tasks.map((task) => [task.id, task]));

  let populationTasks: TaskRow[];
  let windowEvents: EventRow[];

  if (lens === "completed") {
    windowEvents = ownerId ? window.events.filter((event) => event.userId === ownerId) : window.events;
    const ids = new Set(windowEvents.map((event) => event.taskId));
    populationTasks = [...ids].map((id) => taskById.get(id)).filter((task): task is TaskRow => Boolean(task));
  } else if (lens === "created") {
    populationTasks = window.createdTasks.filter((task) => !ownerId || task.createdById === ownerId);
    const ids = new Set(populationTasks.map((task) => task.id));
    windowEvents = window.events.filter((event) => ids.has(event.taskId));
  } else {
    populationTasks = data.tasks.filter((task) => {
      // Habits haben ihren eigenen Block und würden die Zuweisungs-Sicht nur verzerren.
      if (task.isHabit) return false;
      const list = data.assignees.get(task.id);
      if (!list || list.length === 0) return false;
      return !ownerId || list.includes(ownerId);
    });
    const ids = new Set(populationTasks.map((task) => task.id));
    windowEvents = window.events.filter((event) => ids.has(event.taskId));
  }

  const createdTasks = window.createdTasks.filter((task) => !ownerId || task.createdById === ownerId);
  const { days, onTime, late, withoutDeadline } = buildDays(window, windowEvents, createdTasks, taskById, tz);

  let open: number | null = null;
  let overdue: number | null = null;
  let openWithoutDue: number | null = null;
  if (lens === "assigned" && includeCurrentState) {
    const openTasks = populationTasks.filter(
      (task) => !task.isCompleted && !task.isHabit && task.recurrenceType === "none"
    );
    open = openTasks.length;
    openWithoutDue = openTasks.filter((task) => !task.dueAt).length;
    overdue = populationTasks.filter((task) => isTaskOverdue(taskLike(task))).length;
  }

  const distributionTasks =
    lens === "assigned" ? populationTasks.filter((task) => !task.isCompleted && !task.isHabit) : populationTasks;

  return {
    totals: {
      completed: windowEvents.length,
      created: createdTasks.length,
      onTime,
      late,
      withoutDeadline,
      onTimeRate: onTime + late > 0 ? onTime / (onTime + late) : null,
      open,
      overdue,
      openWithoutDue,
    },
    days,
    distributions: buildDistributions(distributionTasks, data),
  };
}

function computeStreak(keys: Set<string>, today: string): { current: number; best: number } {
  const sorted = [...keys].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of sorted) {
    run = previous && daysBetweenKeys(previous, key) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    previous = key;
  }

  let current = 0;
  let cursor = keys.has(today) ? today : shiftDateKey(today, -1);
  while (keys.has(cursor)) {
    current += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return { current, best };
}

function habitItem(habit: TaskRow, occurrenceKeys: Map<string, Set<string>>, tz: string, today: string): HabitStatsItem {
  const createdKey = localDateKey(habit.createdAt, tz);
  const expectedDays = Math.max(0, daysBetweenKeys(createdKey, today) + 1);
  const completedKeys = new Set(
    [...(occurrenceKeys.get(habit.id) ?? new Set<string>())].filter((key) => key >= createdKey && key <= today)
  );
  const completedDays = completedKeys.size;
  const streak = computeStreak(completedKeys, today);

  return {
    taskId: habit.id,
    title: habit.title,
    createdAt: habit.createdAt.toISOString(),
    completedDays,
    expectedDays,
    rate: expectedDays > 0 ? completedDays / expectedDays : null,
    currentStreak: streak.current,
    bestStreak: streak.best,
  };
}

function aggregateHabits(items: HabitStatsItem[]): HabitStatsTotals {
  const completedDays = items.reduce((sum, item) => sum + item.completedDays, 0);
  const expectedDays = items.reduce((sum, item) => sum + item.expectedDays, 0);
  return {
    habits: items.length,
    completedDays,
    expectedDays,
    rate: expectedDays > 0 ? completedDays / expectedDays : null,
    currentStreak: items.reduce((max, item) => Math.max(max, item.currentStreak), 0),
    bestStreak: items.reduce((max, item) => Math.max(max, item.bestStreak), 0),
  };
}

function computeHabits(data: StatsData, scope: StatsScope, userId: string, tz: string, now: Date): HabitStats {
  const today = localDateKey(now, tz);

  const allHabits = data.tasks.filter((task) => task.isHabit);
  const habits = scope === "mine" ? allHabits.filter((habit) => habit.createdById === userId) : allHabits;

  const occurrenceKeys = new Map<string, Set<string>>();
  const habitIds = new Set(habits.map((habit) => habit.id));
  for (const occurrence of data.occurrences) {
    if (!habitIds.has(occurrence.taskId)) continue;
    const key = localDateKey(occurrence.occurrenceDate, tz);
    const set = occurrenceKeys.get(occurrence.taskId) ?? new Set<string>();
    set.add(key);
    occurrenceKeys.set(occurrence.taskId, set);
  }

  const items = habits.map((habit) => habitItem(habit, occurrenceKeys, tz, today)).sort((a, b) => {
    const aRate = a.rate ?? -1;
    const bRate = b.rate ?? -1;
    return bRate - aRate || b.currentStreak - a.currentStreak || a.title.localeCompare(b.title);
  });

  const overall = aggregateHabits(items);

  if (scope === "mine") {
    return { overall, items, perUser: null };
  }

  const byUser = new Map<string, HabitStatsItem[]>();
  for (const item of items) {
    const habit = habits.find((entry) => entry.id === item.taskId);
    if (!habit) continue;
    const list = byUser.get(habit.createdById) ?? [];
    list.push(item);
    byUser.set(habit.createdById, list);
  }

  const perUser: HabitStatsPerUser[] = [...byUser.entries()].map(([id, list]) => ({
    userId: id,
    displayName: data.users.get(id) ?? "—",
    ...aggregateHabits(list),
  }));
  perUser.sort((a, b) => b.completedDays - a.completedDays);

  return { overall, items: null, perUser };
}

export function getTaskStats(options: {
  scope: StatsScope;
  userId: string;
  lens: TaskStatsLens;
  range: ResolvedRange;
  now?: Date;
}): TaskStats {
  const now = options.now ?? new Date();
  const loadFrom =
    options.range.compareStart.getTime() < options.range.start.getTime()
      ? options.range.compareStart
      : options.range.start;
  const data = loadData(loadFrom, options.range.end);
  const ownerId = options.scope === "mine" ? options.userId : null;

  const currentWindow = buildWindow(data, options.range, "current");
  const current = computeWindow(data, currentWindow, options.range.tz, options.lens, ownerId, true);

  const previousWindow = buildWindow(data, options.range, "previous");
  const previous = computeWindow(data, previousWindow, options.range.tz, options.lens, ownerId, false);

  let perUser: TaskStatsPerUser[] | null = null;
  if (options.scope === "all") {
    const rows: TaskStatsPerUser[] = [];
    for (const [id, displayName] of data.users) {
      const computed = computeWindow(data, currentWindow, options.range.tz, options.lens, id, true);
      const totals = computed.totals;
      if (totals.completed + totals.created + (totals.open ?? 0) === 0) continue;
      rows.push({ userId: id, displayName, ...totals });
    }
    rows.sort(
      (a, b) => b.completed - a.completed || b.created - a.created || a.displayName.localeCompare(b.displayName)
    );
    perUser = rows;
  }

  return {
    scope: options.scope,
    lens: options.lens,
    range: rangeInfo(options.range),
    totals: current.totals,
    previous: previous.totals,
    days: current.days,
    distributions: current.distributions,
    habits: computeHabits(data, options.scope, options.userId, options.range.tz, now),
    perUser,
  };
}
