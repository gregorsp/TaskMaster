import { eq, and, SQL, ne, isNotNull } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { tasks, taskAssignees, appMeta, taskOccurrences, users } from "../../db/schema.js";
import { visibilityFilter } from "../../middleware/visibility.js";
import { WEEKDAYS, parseCapacity } from "../../lib/capacity.js";
import { enrichTask } from "../tasks/tasks.service.js";
import type { Weekday } from "../../lib/capacity.js";

interface LoadDayTask {
  id: string;
  title: string;
  pomodoros: number;
  type: "due" | "planned";
  occurrenceId: string | null;
  occurrenceDate: string | null;
}

interface LoadDay {
  date: string;
  weekday: Weekday;
  capacity: number;
  usedSp: number;
  taskCount: number;
  overloaded: boolean;
  tasks: LoadDayTask[];
}

interface HorizonWarning {
  deadlineDate: string;
  requiredSp: number;
  availableSp: number;
  shortfall: number;
}

interface PlanningDraft {
  changes: Record<string, string | null>;
  lastModified: string;
}

export interface PlanningData {
  tasks: ReturnType<typeof enrichTask>[];
  days: LoadDay[];
  draft: PlanningDraft | null;
  horizonWarnings: HorizonWarning[];
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getWeekday(date: Date): Weekday {
  const day = date.getDay();
  const map: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[day];
}

function isoDate(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

const DRAFT_KEY_PREFIX = "planning_draft:";

function draftKey(userId: string): string {
  return DRAFT_KEY_PREFIX + userId;
}

export function getPlanningData(userId: string, isAdmin: boolean, from: Date, to: Date): PlanningData {
  const db = getDb();

  const visFilter = visibilityFilter(userId, isAdmin);
  const conditions: SQL[] = [];
  if (visFilter) conditions.push(visFilter);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const taskRows = db.select().from(tasks)
    .leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId))
    .where(whereClause)
    .groupBy(tasks.id)
    .all()
    .map((r) => r.tasks);

  const enriched = taskRows.map(enrichTask);

  const taskById = new Map(enriched.map((t) => [t.id, t]));

  const occRows = db.select().from(taskOccurrences)
    .where(isNotNull(taskOccurrences.plannedDate))
    .all()
    .filter((o) => {
      if (!o.plannedDate) return false;
      const d = o.plannedDate instanceof Date ? o.plannedDate : new Date(o.plannedDate as unknown as string);
      return d >= start && d <= end;
    });

  const capacity = parseCapacity(
    db.select({ capacity: users.capacity })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.capacity ?? null
  );

  const start = startOfDay(from);
  const end = startOfDay(to);

  const days: LoadDay[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const dayDate = isoDate(cursor);
    const weekday = getWeekday(cursor);
    const cap = capacity?.[weekday] ?? 0;

    const dayTasks: LoadDayTask[] = [];
    let usedSp = 0;

    for (const task of enriched) {
      if (task.isCompleted) continue;

      const planned = task.plannedDate;
      const due = task.effectiveDueAt ? new Date(task.effectiveDueAt) : null;
      const effectiveDate = planned ?? due;

      if (effectiveDate && isoDate(effectiveDate) === dayDate) {
        const type = planned && isoDate(planned) === dayDate ? "planned" : "due";
        const sp = task.pomodoros ?? 0;
        usedSp += sp;
        dayTasks.push({ id: task.id, title: task.title, pomodoros: sp, type, occurrenceId: null, occurrenceDate: null });
      }
    }

    for (const occ of occRows) {
      const occPlannedDate = occ.plannedDate instanceof Date ? occ.plannedDate : new Date(occ.plannedDate as unknown as string);
      if (isoDate(occPlannedDate) === dayDate) {
        const t = taskById.get(occ.taskId);
        if (t && !t.isCompleted) {
          const occDate = occ.occurrenceDate instanceof Date ? occ.occurrenceDate : new Date(occ.occurrenceDate as unknown as string);
          const sp = t.pomodoros ?? 0;
          usedSp += sp;
          dayTasks.push({
            id: t.id,
            title: t.title,
            pomodoros: sp,
            type: "planned" as const,
            occurrenceId: occ.id,
            occurrenceDate: occDate.toISOString(),
          });
        }
      }
    }

    days.push({
      date: dayDate,
      weekday,
      capacity: cap,
      usedSp,
      taskCount: dayTasks.length,
      overloaded: usedSp > cap,
      tasks: dayTasks,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  const horizonWarnings: HorizonWarning[] = [];
  const today = startOfDay(new Date());

  for (const task of enriched) {
    if (task.isCompleted) continue;
    const due = task.effectiveDueAt ? new Date(task.effectiveDueAt) : null;
    if (!due || due > end) continue;

    const deadlineDate = isoDate(due);
    const requiredSp = task.pomodoros ?? 0;
    if (requiredSp === 0) continue;

    let availableSp = 0;
    const d = new Date(today);
    while (d <= due) {
      const wd = getWeekday(d);
      availableSp += capacity?.[wd] ?? 0;
      d.setDate(d.getDate() + 1);
    }

    if (requiredSp > availableSp) {
      horizonWarnings.push({
        deadlineDate,
        requiredSp,
        availableSp,
        shortfall: requiredSp - availableSp,
      });
    }
  }

  const draft = loadDraft(userId);

  return { tasks: enriched, days, draft, horizonWarnings };
}

export function loadDraft(userId: string): PlanningDraft | null {
  const db = getDb();
  const row = db.select({ value: appMeta.value })
    .from(appMeta)
    .where(eq(appMeta.key, draftKey(userId)))
    .get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as PlanningDraft;
  } catch {
    return null;
  }
}

export function saveDraft(userId: string, changes: Record<string, string | null>): PlanningDraft {
  const db = getDb();
  const key = draftKey(userId);
  const draft: PlanningDraft = {
    changes,
    lastModified: new Date().toISOString(),
  };
  const value = JSON.stringify(draft);

  const existing = db.select({ key: appMeta.key })
    .from(appMeta)
    .where(eq(appMeta.key, key))
    .get();

  if (existing) {
    db.update(appMeta).set({ value }).where(eq(appMeta.key, key)).run();
  } else {
    db.insert(appMeta).values({ key, value }).run();
  }

  return draft;
}

export function discardDraft(userId: string): void {
  const db = getDb();
  db.delete(appMeta).where(eq(appMeta.key, draftKey(userId))).run();
}

export function confirmPlanning(userId: string): { updated: number } {
  const db = getDb();
  const draft = loadDraft(userId);
  if (!draft || Object.keys(draft.changes).length === 0) {
    return { updated: 0 };
  }

  let updated = 0;
  for (const [taskId, plannedDateStr] of Object.entries(draft.changes)) {
    const plannedDate = plannedDateStr ? new Date(plannedDateStr) : null;
    db.update(tasks)
      .set({ plannedDate })
      .where(eq(tasks.id, taskId))
      .run();
    updated++;
  }

  discardDraft(userId);
  return { updated };
}
