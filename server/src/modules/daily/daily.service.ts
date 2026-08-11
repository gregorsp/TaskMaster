import { eq, and, SQL, isNotNull, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { tasks, taskOccurrences, taskAssignees, taskCategories, categories, users } from "../../db/schema.js";
import { visibilityFilter } from "../../middleware/visibility.js";
import { enrichTask } from "../tasks/tasks.service.js";
import { getProfilePictureUrl } from "../auth/profile.service.js";

function isoDateOnly(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

interface TaskCategory {
  id: string;
  name: string;
  color: string;
}

interface TaskAssignee {
  id: string;
  username: string;
  displayName: string;
  profilePicture: string | null;
}

export interface DailyHabit {
  id: string;
  title: string;
  description: string | null;
  isImportant: boolean;
  pomodoros: number | null;
  categories: TaskCategory[];
  assignees: TaskAssignee[];
  completedOnDate: boolean;
  completedAt: string | null;
}

export interface DailyTask {
  task: ReturnType<typeof enrichTask>;
  categories: TaskCategory[];
  assignees: TaskAssignee[];
  type: "due" | "planned";
  occurrenceId: string | null;
  occurrenceDate: string | null;
}

export interface DailyData {
  date: string;
  habits: DailyHabit[];
  tasks: DailyTask[];
}

function categoriesByTaskId(taskIds: string[]): Map<string, TaskCategory[]> {
  const db = getDb();
  const map = new Map<string, TaskCategory[]>();
  if (taskIds.length === 0) return map;
  const rows = db
    .select({
      taskId: taskCategories.taskId,
      id: categories.id,
      name: categories.name,
      color: categories.color,
    })
    .from(taskCategories)
    .innerJoin(categories, eq(taskCategories.categoryId, categories.id))
    .where(inArray(taskCategories.taskId, taskIds))
    .all();
  for (const r of rows) {
    const list = map.get(r.taskId) || [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.taskId, list);
  }
  return map;
}

function assigneesByTaskId(taskIds: string[]): Map<string, TaskAssignee[]> {
  const db = getDb();
  const map = new Map<string, TaskAssignee[]>();
  if (taskIds.length === 0) return map;
  const rows = db
    .select({
      taskId: taskAssignees.taskId,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      profilePicture: users.profilePicture,
    })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(inArray(taskAssignees.taskId, taskIds))
    .all();
  for (const r of rows) {
    const list = map.get(r.taskId) || [];
    list.push({
      id: r.id,
      username: r.username,
      displayName: r.displayName,
      profilePicture: getProfilePictureUrl(r.profilePicture),
    });
    map.set(r.taskId, list);
  }
  return map;
}

export function getDailyData(userId: string, isAdmin: boolean, date: Date): DailyData {
  const db = getDb();
  const dayKey = isoDateOnly(date);

  const visFilter = visibilityFilter(userId, isAdmin);
  const conditions: SQL[] = [];
  if (visFilter) conditions.push(visFilter);

  const rows = db.select().from(tasks)
    .leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(tasks.id)
    .all()
    .map((r) => r.tasks);

  const habitRows = rows.filter((t) => t.isHabit);
  const taskRows = rows.filter((t) => !t.isHabit);

  // Habit completion status for the requested day
  const habitIds = habitRows.map((h) => h.id);
  const occurrenceRows = habitIds.length > 0
    ? db.select().from(taskOccurrences)
        .where(inArray(taskOccurrences.taskId, habitIds))
        .all()
    : [];

  const habitCompleted = new Map<string, { isCompleted: boolean; completedAt: string | null }>();
  for (const o of occurrenceRows) {
    const d = o.occurrenceDate instanceof Date ? o.occurrenceDate : new Date(o.occurrenceDate as unknown as string);
    if (isoDateOnly(d) !== dayKey) continue;
    habitCompleted.set(o.taskId, {
      isCompleted: o.isCompleted,
      completedAt: o.completedAt ? (o.completedAt instanceof Date ? o.completedAt.toISOString() : String(o.completedAt)) : null,
    });
  }

  const habitCategories = categoriesByTaskId(habitIds);
  const habitAssignees = assigneesByTaskId(habitIds);

  const habits: DailyHabit[] = habitRows.map((h) => {
    const done = habitCompleted.get(h.id);
    return {
      id: h.id,
      title: h.title,
      description: h.description,
      isImportant: h.isImportant,
      pomodoros: h.pomodoros,
      categories: habitCategories.get(h.id) || [],
      assignees: habitAssignees.get(h.id) || [],
      completedOnDate: done?.isCompleted ?? false,
      completedAt: done?.completedAt ?? null,
    };
  });

  habits.sort((a, b) => a.title.localeCompare(b.title, "de"));

  // Tasks due or planned for the requested day (no habits)
  const enrichedTasks = taskRows.map(enrichTask);
  const tasksForDay: Omit<DailyTask, "categories" | "assignees">[] = [];
  const taskIdsForDay = new Set<string>();

  for (const task of enrichedTasks) {
    const planned = task.plannedDate;
    const due = task.effectiveDueAt ? new Date(task.effectiveDueAt) : null;
    const effective = planned ?? due;
    if (!effective || isoDateOnly(effective) !== dayKey) continue;

    const type = planned && isoDateOnly(planned) === dayKey ? "planned" : "due";
    tasksForDay.push({ task, type, occurrenceId: null, occurrenceDate: null });
    taskIdsForDay.add(task.id);
  }

  // Planned occurrences (rrule) for the day
  const occRows = db.select().from(taskOccurrences)
    .where(isNotNull(taskOccurrences.plannedDate))
    .all()
    .filter((o) => {
      if (!o.plannedDate) return false;
      const d = o.plannedDate instanceof Date ? o.plannedDate : new Date(o.plannedDate as unknown as string);
      return isoDateOnly(d) === dayKey;
    });

  for (const occ of occRows) {
    const t = enrichedTasks.find((e) => e.id === occ.taskId);
    if (!t) continue;
    const occDate = occ.occurrenceDate instanceof Date ? occ.occurrenceDate : new Date(occ.occurrenceDate as unknown as string);
    tasksForDay.push({
      task: t,
      type: "planned",
      occurrenceId: occ.id,
      occurrenceDate: occDate.toISOString(),
    });
    taskIdsForDay.add(t.id);
  }

  const taskCategoriesMap = categoriesByTaskId([...taskIdsForDay]);
  const taskAssigneeMap = assigneesByTaskId([...taskIdsForDay]);

  const dailyTasks: DailyTask[] = tasksForDay.map((entry) => ({
    ...entry,
    categories: taskCategoriesMap.get(entry.task.id) || [],
    assignees: taskAssigneeMap.get(entry.task.id) || [],
  }));

  dailyTasks.sort((a, b) => {
    const aDue = a.task.effectiveDueAt ? new Date(a.task.effectiveDueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.task.effectiveDueAt ? new Date(b.task.effectiveDueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  });

  return { date: toDateString(date), habits, tasks: dailyTasks };
}
