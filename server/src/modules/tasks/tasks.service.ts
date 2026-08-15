import { eq, and, like, or, inArray, ne, SQL, sql as drizzleSql, isNotNull } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { tasks, taskAssignees, taskCategories, taskEvents, taskLinks, taskOccurrences, users, categories } from "../../db/schema.js";
import { visibilityFilter } from "../../middleware/visibility.js";
import { parsePageQuery, paginate } from "../../lib/paging.js";
import { getEffectiveDueAt, isTaskOverdue, computeIsUrgent, getOccurrences } from "../calendar/recurrence.service.js";
import { getProfilePictureUrl } from "../auth/profile.service.js";
import type { CreateTaskInput, UpdateTaskInput } from "./tasks.schema.js";

export function enrichTask(task: typeof tasks.$inferSelect) {
  return {
    ...task,
    isUrgent: computeIsUrgent(task),
    effectiveDueAt: getEffectiveDueAt(task)?.toISOString() || null,
    isOverdue: isTaskOverdue(task),
  };
}

interface TaskAssignee {
  id: string;
  username: string;
  displayName: string;
  profilePicture: string | null;
}

function assigneesByTaskId(taskIds: string[]) {
  const db = getDb();
  if (taskIds.length === 0) return new Map<string, TaskAssignee[]>();
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
  const map = new Map<string, TaskAssignee[]>();
  for (const row of rows) {
    const list = map.get(row.taskId) || [];
    list.push({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      profilePicture: getProfilePictureUrl(row.profilePicture),
    });
    map.set(row.taskId, list);
  }
  return map;
}

export interface TaskCategory {
  id: string;
  name: string;
  color: string;
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

function linkCountsByTaskId(taskIds: string[]): Map<string, number> {
  const db = getDb();
  const map = new Map<string, number>();
  if (taskIds.length === 0) return map;
  const rows = db
    .select({ a: taskLinks.taskIdA, b: taskLinks.taskIdB })
    .from(taskLinks)
    .all();
  for (const id of taskIds) {
    const linked = new Set<string>();
    for (const r of rows) {
      if (r.a === id) linked.add(r.b);
      if (r.b === id) linked.add(r.a);
    }
    map.set(id, linked.size);
  }
  return map;
}

export function withRelations<T extends { id: string }>(
  items: T[]
): (T & { assignees: TaskAssignee[]; categories: TaskCategory[]; linkCount: number })[] {
  const ids = items.map((i) => i.id);
  const assignees = assigneesByTaskId(ids);
  const cats = categoriesByTaskId(ids);
  const links = linkCountsByTaskId(ids);
  return items.map((item) => ({
    ...item,
    assignees: assignees.get(item.id) || [],
    categories: cats.get(item.id) || [],
    linkCount: links.get(item.id) || 0,
  }));
}

export function listTasks(
  userId: string,
  isAdmin: boolean,
  query: Record<string, unknown>
) {
  const db = getDb();
  const paging = parsePageQuery(query);

  const visFilter = visibilityFilter(userId, isAdmin);
  const conditions: SQL[] = [];

  if (visFilter) conditions.push(visFilter);

  const isCompleted = query.isCompleted !== undefined
    ? (query.isCompleted === "true" || query.isCompleted === true)
    : undefined;
  if (isCompleted !== undefined) conditions.push(eq(tasks.isCompleted, isCompleted));

  if (query.important !== undefined && (query.important === "true" || query.important === true))
    conditions.push(eq(tasks.isImportant, true));
  if (query.urgent !== undefined && (query.urgent === "true" || query.urgent === true))
    conditions.push(eq(tasks.isUrgent, true));

  if (query.isHabit !== undefined) {
    const isHabit = query.isHabit === "true" || query.isHabit === true;
    conditions.push(eq(tasks.isHabit, isHabit));
  }

  if (query.search) {
    const term = `%${query.search}%`;
    conditions.push(or(like(tasks.title, term), like(tasks.description, term)) as SQL);
  }

  if (query.categoryId) {
    const sub = db.select({ taskId: taskCategories.taskId }).from(taskCategories).where(eq(taskCategories.categoryId, query.categoryId as string));
    const ids = sub.all().map((r) => r.taskId);
    if (ids.length > 0) conditions.push(inArray(tasks.id, ids));
    else return paginate([], 0, paging);
  }

  if (query.assigneeId) {
    const sub = db.select({ taskId: taskAssignees.taskId }).from(taskAssignees).where(eq(taskAssignees.userId, query.assigneeId as string));
    const ids = sub.all().map((r) => r.taskId);
    if (ids.length > 0) conditions.push(inArray(tasks.id, ids));
    else return paginate([], 0, paging);
  }

  if (query.assigneeIds) {
    const ids = String(query.assigneeIds).split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      const rows = db
        .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(inArray(taskAssignees.userId, ids))
        .all();
      const perUser = new Map<string, Set<string>>();
      for (const r of rows) {
        if (!perUser.has(r.userId)) perUser.set(r.userId, new Set());
        perUser.get(r.userId)!.add(r.taskId);
      }
      let matching = new Set(perUser.get(ids[0]) || []);
      for (let i = 1; i < ids.length && matching.size > 0; i++) {
        const set = perUser.get(ids[i]);
        if (!set) {
          matching = new Set();
          break;
        }
        matching = new Set([...matching].filter((x) => set.has(x)));
      }
      if (matching.size > 0) conditions.push(inArray(tasks.id, [...matching]));
      else return paginate([], 0, paging);
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rawItems = db.select().from(tasks)
    .leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId))
    .where(whereClause)
    .groupBy(tasks.id)
    .all()
    .map((r) => r.tasks);

  let enriched = rawItems.map(enrichTask);

  if (query.isOverdue === "true" || query.isOverdue === true) {
    enriched = enriched.filter((t) => t.isOverdue);
  }

  let sorted = enriched;
  const sort = (query.sort as string) || "createdAt";
  const order = (query.order as "asc" | "desc") || "desc";
  if (sort === "dueAt") {
    sorted = enriched.sort((a, b) => {
      const da = a.effectiveDueAt ? new Date(a.effectiveDueAt).getTime() : 0;
      const db = b.effectiveDueAt ? new Date(b.effectiveDueAt).getTime() : 0;
      return order === "asc" ? da - db : db - da;
    });
  } else {
    sorted = enriched.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return order === "asc" ? da - db : db - da;
    });
  }

  const total = sorted.length;
  const start = (paging.page - 1) * paging.pageSize;
  const items = sorted.slice(start, start + paging.pageSize);

  return paginate(withRelations(items), total, paging);
}

export async function getTask(id: string, userId: string, isAdmin: boolean) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return null;

  const assignees = db
    .select({ id: users.id, username: users.username, displayName: users.displayName, profilePicture: users.profilePicture })
    .from(taskAssignees).innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(eq(taskAssignees.taskId, id)).all()
    .map((a) => ({ ...a, profilePicture: getProfilePictureUrl(a.profilePicture) }));

  const cats = db
    .select({ id: categories.id, name: categories.name, color: categories.color })
    .from(taskCategories).innerJoin(categories, eq(taskCategories.categoryId, categories.id))
    .where(eq(taskCategories.taskId, id)).all();

  return enrichTask({ ...task, assignees, categories: cats } as unknown as typeof task);
}

export function createTask(input: CreateTaskInput, createdById: string) {
  const db = getDb();
  const isHabit = input.isHabit ?? false;
  const dueAtVal = isHabit ? null
    : input.recurrenceType === "rrule" ? null
    : input.dueAt ? new Date(input.dueAt) : null;
  const baseDateVal = !isHabit && input.recurrenceType === "rrule" && input.dueAt
    ? new Date(input.dueAt) : null;

  const task = {
    id: uuid(),
    title: input.title,
    description: input.description || null,
    dueAt: dueAtVal,
    baseDate: baseDateVal,
    lastCompletedAt: null,
    isCompleted: false,
    completedAt: null,
    completedById: null,
    isImportant: input.isImportant ?? false,
    pomodoros: input.pomodoros ?? null,
    isUrgent: false, // computed field
    urgencyMode: isHabit ? "never" : (input.urgencyMode ?? "before_days"),
    urgencyValue: isHabit ? null : (input.urgencyValue ?? 3),
    isPrivate: isHabit ? true : (input.isPrivate ?? false),
    isHabit,
    recurrenceType: isHabit ? "none" : (input.recurrenceType ?? "none"),
    recurrenceRule: isHabit ? null : (input.recurrenceRule || null),
    parentId: isHabit ? null : (input.parentId || null),
    plannedDate: isHabit ? null : (input.plannedDate ? new Date(input.plannedDate) : null),
    createdById,
    createdAt: new Date(),
  };

  db.insert(tasks).values(task).run();

  const seen = new Set<string>();
  seen.add(createdById);
  db.insert(taskAssignees).values({ taskId: task.id, userId: createdById }).run();

  if (!isHabit) {
    for (const assigneeId of (input.assigneeIds || [])) {
      if (!seen.has(assigneeId)) {
        seen.add(assigneeId);
        db.insert(taskAssignees).values({ taskId: task.id, userId: assigneeId }).run();
      }
    }
  }
  for (const catId of (input.categoryIds || [])) {
    db.insert(taskCategories).values({ taskId: task.id, categoryId: catId }).run();
  }

  return task;
}

export async function updateTask(id: string, input: UpdateTaskInput, userId: string, isAdmin: boolean) {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return null;

  const isHabit = input.isHabit ?? existing.isHabit;

  const updates: Record<string, unknown> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.isImportant !== undefined) updates.isImportant = input.isImportant;
  if (input.pomodoros !== undefined) updates.pomodoros = input.pomodoros;
  if (input.isPrivate !== undefined && !isHabit) updates.isPrivate = input.isPrivate;
  if (input.urgencyMode !== undefined) updates.urgencyMode = input.urgencyMode;
  if (input.urgencyValue !== undefined) updates.urgencyValue = input.urgencyValue;
  if (input.isHabit !== undefined && input.isHabit !== existing.isHabit) updates.isHabit = input.isHabit;

  const becomingHabit = input.isHabit === true && existing.isHabit !== true;
  if (becomingHabit) {
    updates.isPrivate = true;
    updates.plannedDate = null;
    updates.dueAt = null;
    updates.baseDate = null;
    updates.recurrenceType = "none";
    updates.recurrenceRule = null;
    updates.parentId = null;
    updates.urgencyMode = "never";
    updates.urgencyValue = null;
  }

  const recurrenceChanging = (input.recurrenceType !== undefined && input.recurrenceType !== existing.recurrenceType)
    || (input.recurrenceRule !== undefined && input.recurrenceRule !== existing.recurrenceRule);

  if (recurrenceChanging && !input.forceUpdateRecurrence && !becomingHabit) {
    const plannedRows = db.select({ id: taskOccurrences.id })
      .from(taskOccurrences)
      .where(and(eq(taskOccurrences.taskId, id), isNotNull(taskOccurrences.plannedDate)))
      .all();
    if (plannedRows.length > 0) {
      return { blocked: true, code: "WILL_DELETE_PLANNED_OCCURRENCES", count: plannedRows.length };
    }
  }

  if (input.recurrenceType !== undefined && !isHabit) updates.recurrenceType = input.recurrenceType;
  if (input.recurrenceRule !== undefined && !isHabit) updates.recurrenceRule = input.recurrenceRule;
  if (input.parentId !== undefined && !isHabit) updates.parentId = input.parentId;
  if (input.plannedDate !== undefined && !isHabit) updates.plannedDate = input.plannedDate ? new Date(input.plannedDate) : null;

  if (input.dueAt !== undefined && !isHabit) {
    if (input.recurrenceType === "rrule" || existing.recurrenceType === "rrule") {
      updates.baseDate = input.dueAt ? new Date(input.dueAt) : null;
      updates.dueAt = null;
    } else {
      updates.dueAt = input.dueAt ? new Date(input.dueAt) : null;
    }
  }

  if (Object.keys(updates).length > 0) {
    db.update(tasks).set(updates).where(eq(tasks.id, id)).run();
  }

  if (recurrenceChanging && input.forceUpdateRecurrence) {
    db.delete(taskOccurrences)
      .where(and(eq(taskOccurrences.taskId, id), isNotNull(taskOccurrences.plannedDate)))
      .run();
  }

  if (becomingHabit) {
    db.delete(taskOccurrences)
      .where(eq(taskOccurrences.taskId, id))
      .run();
  }

  if (input.assigneeIds !== undefined && !isHabit) {
    db.delete(taskAssignees).where(eq(taskAssignees.taskId, id)).run();
    for (const aid of input.assigneeIds) {
      db.insert(taskAssignees).values({ taskId: id, userId: aid }).run();
    }
  }
  if (isHabit) {
    db.delete(taskAssignees).where(eq(taskAssignees.taskId, id)).run();
    db.insert(taskAssignees).values({ taskId: id, userId: userId }).run();
  }
  if (input.categoryIds !== undefined) {
    db.delete(taskCategories).where(eq(taskCategories.taskId, id)).run();
    for (const cid of input.categoryIds) {
      db.insert(taskCategories).values({ taskId: id, categoryId: cid }).run();
    }
  }

  return getTask(id, userId, isAdmin);
}

export async function deleteTask(id: string): Promise<boolean | { blocked: boolean; code: string }> {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return false;

  const childCount = db.select({ count: drizzleSql<number>`COUNT(*)` }).from(tasks).where(eq(tasks.parentId, id)).get();
  if (childCount && childCount.count > 0) {
    return { blocked: true, code: "HAS_SUBTASKS" };
  }

  db.delete(taskAssignees).where(eq(taskAssignees.taskId, id)).run();
  db.delete(taskCategories).where(eq(taskCategories.taskId, id)).run();
  db.delete(taskEvents).where(eq(taskEvents.taskId, id)).run();
  db.delete(taskLinks).where(or(eq(taskLinks.taskIdA, id), eq(taskLinks.taskIdB, id))).run();
  db.delete(tasks).where(eq(tasks.id, id)).run();
  return true;
}

export function getSubtasks(taskId: string) {
  const db = getDb();
  const children = db.select().from(tasks).where(eq(tasks.parentId, taskId)).all();

  const completed = children.filter((c) => c.isCompleted).length;
  const total = children.length;

  const allDescendantIds = new Set<string>();
  for (const child of children) {
    allDescendantIds.add(child.id);
    collectDescendantIds(child.id, allDescendantIds);
  }
  const allDescendants = [...allDescendantIds];

  let completedDescendants = 0;
  for (const id of allDescendants) {
    const t = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (t?.isCompleted) completedDescendants++;
  }

  return {
    subtasks: withRelations(children.map(enrichTask)),
    progress: {
      completed: completedDescendants,
      total: allDescendants.length,
    },
  };
}

export function collectDescendantIds(taskId: string, result: Set<string>) {
  const db = getDb();
  const children = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, taskId)).all();
  for (const child of children) {
    if (!result.has(child.id)) {
      result.add(child.id);
      collectDescendantIds(child.id, result);
    }
  }
}

export function getOpenSubtaskCount(taskId: string): number {
  const db = getDb();
  const descendantIds = new Set<string>();
  collectDescendantIds(taskId, descendantIds);
  if (descendantIds.size === 0) return 0;

  const rows = db.select({ id: tasks.id, isCompleted: tasks.isCompleted })
    .from(tasks)
    .where(inArray(tasks.id, [...descendantIds]))
    .all();

  return rows.filter((r) => !r.isCompleted).length;
}

export function getSiblings(taskId: string) {
  const db = getDb();
  const task = db.select({ parentId: tasks.parentId }).from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task?.parentId) return [];

  const siblings = db.select().from(tasks)
    .where(eq(tasks.parentId, task.parentId))
    .all();
  const filtered = siblings.filter((s) => s.id !== taskId);
  return withRelations(filtered.map(enrichTask));
}

export function getTaskLinks(taskId: string) {
  const db = getDb();
  const rows = db.select({
    taskId: drizzleSql<string>`CASE WHEN task_links.task_id_a = ${taskId} THEN task_links.task_id_b ELSE task_links.task_id_a END`,
  }).from(taskLinks)
    .where(or(eq(taskLinks.taskIdA, taskId), eq(taskLinks.taskIdB, taskId)))
    .all();

  if (rows.length === 0) return [];

  const linkedIds = rows.map((r) => r.taskId);
  const linkedTasks = db.select().from(tasks).where(inArray(tasks.id, linkedIds)).all();
  return withRelations(linkedTasks.map(enrichTask));
}

export function addTaskLink(taskId: string, linkedTaskId: string) {
  const db = getDb();
  const now = new Date();
  db.insert(taskLinks).values({ taskIdA: taskId, taskIdB: linkedTaskId, createdAt: now }).run();
  db.insert(taskLinks).values({ taskIdA: linkedTaskId, taskIdB: taskId, createdAt: now }).run();
  return { ok: true };
}

export function removeTaskLink(taskId: string, linkedTaskId: string) {
  const db = getDb();
  db.delete(taskLinks).where(
    and(eq(taskLinks.taskIdA, taskId), eq(taskLinks.taskIdB, linkedTaskId))
  ).run();
  db.delete(taskLinks).where(
    and(eq(taskLinks.taskIdA, linkedTaskId), eq(taskLinks.taskIdB, taskId))
  ).run();
  return { ok: true };
}

export function getTaskOccurrences(taskId: string) {
  const db = getDb();
  return db.select().from(taskOccurrences).where(eq(taskOccurrences.taskId, taskId)).all();
}

export function createTaskOccurrence(taskId: string, occurrenceDate: string, plannedDate: string | null) {
  const db = getDb();
  const occDate = new Date(occurrenceDate);
  const existing = db.select().from(taskOccurrences)
    .where(and(eq(taskOccurrences.taskId, taskId), eq(taskOccurrences.occurrenceDate, occDate)))
    .get();

  if (existing) {
    db.update(taskOccurrences).set({ plannedDate: plannedDate ? new Date(plannedDate) : null })
      .where(eq(taskOccurrences.id, existing.id)).run();
    return existing;
  }

  const row = {
    id: uuid(),
    taskId,
    occurrenceDate: occDate,
    plannedDate: plannedDate ? new Date(plannedDate) : null,
    isCompleted: false,
    completedAt: null,
    completedById: null,
    note: null,
    createdAt: new Date(),
  };
  db.insert(taskOccurrences).values(row).run();
  return row;
}

export function deleteTaskOccurrence(occurrenceId: string) {
  const db = getDb();
  db.delete(taskOccurrences).where(eq(taskOccurrences.id, occurrenceId)).run();
  return { ok: true };
}

export function getUpcomingOccurrences(taskId: string, count = 3, showPast = false) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task || task.recurrenceType !== "rrule" || !task.recurrenceRule || !task.baseDate) {
    return [];
  }

  const rows = db.select().from(taskOccurrences).where(eq(taskOccurrences.taskId, taskId)).all();

  const completedDates = new Set<string>();
  const plannedMap = new Map<string, string>();

  for (const r of rows) {
    const iso = r.occurrenceDate instanceof Date
      ? new Date(r.occurrenceDate.getFullYear(), r.occurrenceDate.getMonth(), r.occurrenceDate.getDate()).toISOString()
      : "";
    if (r.isCompleted) completedDates.add(iso);
    if (r.plannedDate) plannedMap.set(iso, r.plannedDate instanceof Date ? r.plannedDate.toISOString() : String(r.plannedDate));
  }

  const now = new Date();
  const to = new Date();
  to.setFullYear(to.getFullYear() + 2);

  let dates: Date[];
  if (showPast && task.baseDate) {
    const past = getOccurrences(task.recurrenceRule, task.baseDate, now, task.baseDate);
    const future = getOccurrences(task.recurrenceRule, now, to, task.baseDate).slice(0, count);
    const seen = new Set<string>();
    dates = [];
    for (const d of [...past, ...future]) {
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      if (!seen.has(key)) {
        seen.add(key);
        dates.push(d);
      }
    }
  } else {
    dates = getOccurrences(task.recurrenceRule, now, to, task.baseDate).slice(0, count);
  }

  return dates.map((d) => {
    const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    return {
      date: d,
      iso,
      isCompleted: completedDates.has(iso),
      completedAt: null,
      isPlanned: plannedMap.has(iso),
      plannedDate: plannedMap.get(iso) || null,
    };
  });
}
