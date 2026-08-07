import { eq, and, like, or, SQL, desc, asc } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { tasks, taskAssignees, taskCategories, taskEvents, users, categories } from "../../db/schema.js";
import { visibilityFilter } from "../../middleware/visibility.js";
import { parsePageQuery, paginate } from "../../lib/paging.js";
import { getEffectiveDueAt, isTaskOverdue, computeIsUrgent } from "../calendar/recurrence.service.js";
import type { CreateTaskInput, UpdateTaskInput } from "./tasks.schema.js";

function enrichTask(task: typeof tasks.$inferSelect) {
  return {
    ...task,
    isUrgent: computeIsUrgent(task),
    effectiveDueAt: getEffectiveDueAt(task)?.toISOString() || null,
    isOverdue: isTaskOverdue(task),
  };
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

  if (query.search) {
    const term = `%${query.search}%`;
    conditions.push(or(like(tasks.title, term), like(tasks.description, term)) as SQL);
  }

  if (query.categoryId) {
    const sub = db.select({ taskId: taskCategories.taskId }).from(taskCategories).where(eq(taskCategories.categoryId, query.categoryId as string));
    const ids = sub.all().map((r) => r.taskId);
    if (ids.length > 0) for (const id of ids) conditions.push(eq(tasks.id, id));
    else return paginate([], 0, paging);
  }

  if (query.assigneeId) {
    const sub = db.select({ taskId: taskAssignees.taskId }).from(taskAssignees).where(eq(taskAssignees.userId, query.assigneeId as string));
    const ids = sub.all().map((r) => r.taskId);
    if (ids.length > 0) for (const id of ids) conditions.push(eq(tasks.id, id));
    else return paginate([], 0, paging);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rawItems = db.select().from(tasks)
    .leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId))
    .where(whereClause)
    .groupBy(tasks.id)
    .all()
    .map((r) => r.tasks);

  const enriched = rawItems.map(enrichTask);

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

  return paginate(items, total, paging);
}

export async function getTask(id: string, userId: string, isAdmin: boolean) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return null;

  const assignees = db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(taskAssignees).innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(eq(taskAssignees.taskId, id)).all();

  const cats = db
    .select({ id: categories.id, name: categories.name, color: categories.color })
    .from(taskCategories).innerJoin(categories, eq(taskCategories.categoryId, categories.id))
    .where(eq(taskCategories.taskId, id)).all();

  return enrichTask({ ...task, assignees, categories: cats } as unknown as typeof task);
}

export function createTask(input: CreateTaskInput, createdById: string) {
  const db = getDb();
  const dueAtVal = input.recurrenceType === "rrule" ? null
    : input.dueAt ? new Date(input.dueAt) : null;
  const baseDateVal = input.recurrenceType === "rrule" && input.dueAt
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
  if (input.isPrivate !== undefined) updates.isPrivate = input.isPrivate;
  if (input.urgencyMode !== undefined) updates.urgencyMode = input.urgencyMode;
  if (input.urgencyValue !== undefined) updates.urgencyValue = input.urgencyValue;
  if (input.recurrenceType !== undefined) updates.recurrenceType = input.recurrenceType;
  if (input.recurrenceRule !== undefined) updates.recurrenceRule = input.recurrenceRule;

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
  db.delete(taskAssignees).where(eq(taskAssignees.taskId, id)).run();
  db.delete(taskCategories).where(eq(taskCategories.taskId, id)).run();
  db.delete(taskEvents).where(eq(taskEvents.taskId, id)).run();
  db.delete(tasks).where(eq(tasks.id, id)).run();
  return true;
}

export function listOverdueTasks(userId: string, isAdmin: boolean) {
  const db = getDb();
  const visFilter = visibilityFilter(userId, isAdmin);
  const conditions: SQL[] = [eq(tasks.isCompleted, false)];
  if (visFilter) conditions.push(visFilter);

  const rawItems = db.select().from(tasks)
    .leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId))
    .where(and(...conditions))
    .groupBy(tasks.id)
    .all()
    .map((r) => r.tasks);

  const items = rawItems
    .filter((t) => isTaskOverdue(t))
    .map(enrichTask)
    .sort((a, b) => {
      const da = a.effectiveDueAt ? new Date(a.effectiveDueAt).getTime() : 0;
      const db = b.effectiveDueAt ? new Date(b.effectiveDueAt).getTime() : 0;
      return da - db;
    });

  return { items, total: items.length };
}
