import { eq, and, or, like, inArray, isNull, count, SQL } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { tasks, taskAssignees, taskCategories, taskEvents, taskLinks, users, categories } from "../../db/schema.js";
import { visibilityFilter, isVisibleToUser } from "../../middleware/visibility.js";
import { parsePageQuery, paginate } from "../../lib/paging.js";
import { getEffectiveDueAt, isTaskOverdue, computeIsUrgent } from "../calendar/recurrence.service.js";
import { getProfilePictureUrl } from "../auth/profile.service.js";
import type { CreateTaskInput, UpdateTaskInput } from "./tasks.schema.js";

function enrichTask(task: typeof tasks.$inferSelect) {
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

function withAssignees<T extends { id: string }>(items: T[]): (T & { assignees: TaskAssignee[] })[] {
  const map = assigneesByTaskId(items.map((i) => i.id));
  return items.map((item) => ({ ...item, assignees: map.get(item.id) || [] }));
}

function isAncestorOf(proposedParentId: string, taskId: string): boolean {
  const db = getDb();
  let current: string | null = proposedParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === taskId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    const row = db.select({ parentId: tasks.parentId }).from(tasks).where(eq(tasks.id, current)).get();
    current = row?.parentId ?? null;
  }
  return false;
}

async function resolveParentId(
  parentId: string | null | undefined,
  taskId: string | null,
  userId: string,
  isAdmin: boolean
): Promise<string | null> {
  if (!parentId) return null;
  if (taskId && parentId === taskId) {
    throw Object.assign(new Error("Task cannot be its own subtask"), { statusCode: 400, code: "INVALID_PARENT" });
  }
  const db = getDb();
  const parent = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, parentId)).get();
  if (!parent) {
    throw Object.assign(new Error("Parent task not found"), { statusCode: 404, code: "PARENT_NOT_FOUND" });
  }
  if (taskId && isAncestorOf(parentId, taskId)) {
    throw Object.assign(new Error("Cannot set a descendant as parent"), { statusCode: 400, code: "CYCLE_DETECTED" });
  }
  if (!(await isVisibleToUser(parentId, userId, isAdmin))) {
    throw Object.assign(new Error("Parent task not found"), { statusCode: 404, code: "PARENT_NOT_FOUND" });
  }
  return parentId;
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

  if (query.parentId !== undefined) {
    if (query.parentId === "_none_") {
      conditions.push(isNull(tasks.parentId));
    } else {
      conditions.push(eq(tasks.parentId, query.parentId as string));
    }
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

  return paginate(withAssignees(items), total, paging);
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

export async function createTask(input: CreateTaskInput, createdById: string, isAdmin: boolean) {
  const db = getDb();
  const dueAtVal = input.recurrenceType === "rrule" ? null
    : input.dueAt ? new Date(input.dueAt) : null;
  const baseDateVal = input.recurrenceType === "rrule" && input.dueAt
    ? new Date(input.dueAt) : null;

  const parentId = await resolveParentId(input.parentId, null, createdById, isAdmin);

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
    parentId,
    isImportant: input.isImportant ?? false,
    pomodoros: input.pomodoros ?? null,
    isUrgent: false, // computed field
    urgencyMode: input.urgencyMode ?? "before_days",
    urgencyValue: input.urgencyValue ?? 3,
    isPrivate: input.isPrivate ?? false,
    recurrenceType: input.recurrenceType ?? "none",
    recurrenceRule: input.recurrenceRule || null,
    createdById,
    createdAt: new Date(),
  };

  db.insert(tasks).values(task).run();

  const seen = new Set<string>();
  seen.add(createdById);
  db.insert(taskAssignees).values({ taskId: task.id, userId: createdById }).run();

  for (const assigneeId of (input.assigneeIds || [])) {
    if (!seen.has(assigneeId)) {
      seen.add(assigneeId);
      db.insert(taskAssignees).values({ taskId: task.id, userId: assigneeId }).run();
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

  const updates: Record<string, unknown> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.isImportant !== undefined) updates.isImportant = input.isImportant;
  if (input.pomodoros !== undefined) updates.pomodoros = input.pomodoros;
  if (input.isPrivate !== undefined) updates.isPrivate = input.isPrivate;
  if (input.urgencyMode !== undefined) updates.urgencyMode = input.urgencyMode;
  if (input.urgencyValue !== undefined) updates.urgencyValue = input.urgencyValue;
  if (input.recurrenceType !== undefined) updates.recurrenceType = input.recurrenceType;
  if (input.recurrenceRule !== undefined) updates.recurrenceRule = input.recurrenceRule;

  if (input.parentId !== undefined) {
    updates.parentId = await resolveParentId(input.parentId, id, userId, isAdmin);
  }

  if (input.dueAt !== undefined) {
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

  if (input.assigneeIds !== undefined) {
    db.delete(taskAssignees).where(eq(taskAssignees.taskId, id)).run();
    for (const aid of input.assigneeIds) {
      db.insert(taskAssignees).values({ taskId: id, userId: aid }).run();
    }
  }
  if (input.categoryIds !== undefined) {
    db.delete(taskCategories).where(eq(taskCategories.taskId, id)).run();
    for (const cid of input.categoryIds) {
      db.insert(taskCategories).values({ taskId: id, categoryId: cid }).run();
    }
  }

  return getTask(id, userId, isAdmin);
}

export async function deleteTask(id: string): Promise<boolean> {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return false;

  const children = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, id)).all();
  if (children.length > 0) {
    throw Object.assign(new Error(`${children.length} subtasks still exist`), {
      statusCode: 409, code: "HAS_SUBTASKS", subtaskCount: children.length,
    });
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
  const subtasks = db.select().from(tasks).where(eq(tasks.parentId, taskId)).all();
  const enriched = withAssignees(subtasks.map(enrichTask));

  const childIds = enriched.map((t) => t.id);
  const countMap = new Map<string, number>();
  if (childIds.length > 0) {
    const rows = db
      .select({ parentId: tasks.parentId, count: count() })
      .from(tasks)
      .where(inArray(tasks.parentId, childIds))
      .groupBy(tasks.parentId)
      .all();
    for (const r of rows) countMap.set(r.parentId!, r.count);
  }

  const subtasksWithCount = enriched.map((t) => ({ ...t, subtaskCount: countMap.get(t.id) ?? 0 }));
  const total = subtasksWithCount.length;
  const completed = subtasksWithCount.filter((t) => t.isCompleted).length;
  return {
    subtasks: subtasksWithCount,
    progress: { completed, total },
  };
}

export function getTaskLinks(taskId: string, userId: string, isAdmin: boolean) {
  const db = getDb();
  const conditions: SQL[] = [eq(taskLinks.taskIdA, taskId)];
  const visFilter = visibilityFilter(userId, isAdmin);
  if (visFilter) conditions.push(visFilter);

  const rows = db
    .select({
      id: tasks.id,
      title: tasks.title,
      pomodoros: tasks.pomodoros,
      isCompleted: tasks.isCompleted,
      isPrivate: tasks.isPrivate,
      dueAt: tasks.dueAt,
    })
    .from(taskLinks)
    .innerJoin(tasks, eq(tasks.id, taskLinks.taskIdB))
    .leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId))
    .where(and(...conditions))
    .groupBy(tasks.id)
    .all();
  return rows;
}

export async function addTaskLink(taskId: string, linkedTaskId: string, userId: string, isAdmin: boolean) {
  const db = getDb();
  if (taskId === linkedTaskId) {
    throw Object.assign(new Error("Task cannot be linked to itself"), { statusCode: 400, code: "INVALID_LINK" });
  }

  const linked = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, linkedTaskId)).get();
  if (!linked) {
    throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });
  }
  if (!(await isVisibleToUser(linkedTaskId, userId, isAdmin))) {
    throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });
  }

  const now = new Date();
  db.insert(taskLinks).values({ taskIdA: taskId, taskIdB: linkedTaskId, createdAt: now }).onConflictDoNothing().run();
  db.insert(taskLinks).values({ taskIdA: linkedTaskId, taskIdB: taskId, createdAt: now }).onConflictDoNothing().run();
  return true;
}

export function removeTaskLink(taskId: string, linkedTaskId: string) {
  const db = getDb();
  db.delete(taskLinks)
    .where(or(
      and(eq(taskLinks.taskIdA, taskId), eq(taskLinks.taskIdB, linkedTaskId)),
      and(eq(taskLinks.taskIdA, linkedTaskId), eq(taskLinks.taskIdB, taskId)),
    ))
    .run();
  return true;
}

export function getAllTaskLinks(userId: string, isAdmin: boolean) {
  const db = getDb();
  const visFilter = visibilityFilter(userId, isAdmin);
  const taskRows = db
    .select({ id: tasks.id })
    .from(tasks)
    .leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId))
    .where(visFilter)
    .groupBy(tasks.id)
    .all();
  const visible = new Set(taskRows.map((r) => r.id));
  if (visible.size === 0) return [];

  const linkRows = db
    .select({ a: taskLinks.taskIdA, b: taskLinks.taskIdB })
    .from(taskLinks)
    .all();

  return linkRows.filter((r) => visible.has(r.a) && visible.has(r.b));
}

export function getTaskRelations(taskId: string, userId: string, isAdmin: boolean) {
  const db = getDb();
  const pick = (t: typeof tasks.$inferSelect) => ({
    id: t.id,
    title: t.title,
    pomodoros: t.pomodoros,
    isCompleted: t.isCompleted,
    parentId: t.parentId,
  });

  const taskRow = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!taskRow) {
    return { ancestors: [], current: null, descendants: [], links: {} };
  }

  const ancestors: ReturnType<typeof pick>[] = [];
  let cur = taskRow;
  const seen = new Set<string>();
  while (cur.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    const parent = db.select().from(tasks).where(eq(tasks.id, cur.parentId)).get();
    if (!parent) break;
    ancestors.unshift(pick(parent));
    cur = parent;
  }

  const descendants: ReturnType<typeof pick>[] = [];
  let frontier: string[] = [taskId];
  const visited = new Set<string>([taskId]);
  while (frontier.length > 0) {
    const rows = db.select().from(tasks).where(inArray(tasks.parentId, frontier)).all();
    const next: string[] = [];
    for (const r of rows) {
      if (visited.has(r.id)) continue;
      visited.add(r.id);
      descendants.push(pick(r));
      next.push(r.id);
    }
    frontier = next;
  }

  const allIds = [taskId, ...ancestors.map((a) => a.id), ...descendants.map((d) => d.id)];
  const links: Record<string, { id: string; title: string; pomodoros: number | null; isCompleted: boolean }[]> = {};
  if (allIds.length > 0) {
    const conditions: SQL[] = [inArray(taskLinks.taskIdA, allIds)];
    const visFilter = visibilityFilter(userId, isAdmin);
    if (visFilter) conditions.push(visFilter);

    const rows = db
      .select({
        ownerId: taskLinks.taskIdA,
        id: tasks.id,
        title: tasks.title,
        pomodoros: tasks.pomodoros,
        isCompleted: tasks.isCompleted,
      })
      .from(taskLinks)
      .innerJoin(tasks, eq(tasks.id, taskLinks.taskIdB))
      .leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId))
      .where(and(...conditions))
      .groupBy(taskLinks.taskIdA, tasks.id)
      .all();

    for (const r of rows) {
      if (!links[r.ownerId]) links[r.ownerId] = [];
      links[r.ownerId].push({ id: r.id, title: r.title, pomodoros: r.pomodoros, isCompleted: r.isCompleted });
    }
  }

  return { ancestors, current: pick(taskRow), descendants, links };
}


