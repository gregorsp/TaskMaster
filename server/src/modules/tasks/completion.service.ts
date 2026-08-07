import { eq } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { tasks, taskEvents, users } from "../../db/schema.js";
import { getNextOccurrence } from "../calendar/recurrence.service.js";

export async function completeTask(
  taskId: string,
  completedById: string,
  nextDueAt?: string,
  comment?: string
) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });

  const now = new Date();

  const evt = {
    id: uuid(),
    taskId,
    userId: completedById,
    type: "completed" as const,
    content: comment || null,
    createdAt: now,
  };
  db.insert(taskEvents).values(evt).run();

  if (task.recurrenceType === "none") {
    db.update(tasks).set({
      isCompleted: true,
      completedAt: now,
      completedById,
      lastCompletedAt: now,
    }).where(eq(tasks.id, taskId)).run();
    return { completed: true, nextDueAt: null };
  }

  if (task.recurrenceType === "on_completion") {
    if (!nextDueAt) {
      throw Object.assign(new Error("nextDueAt is required for on_completion tasks"), {
        statusCode: 400, code: "MISSING_NEXT_DUE_AT",
      });
    }
    db.update(tasks).set({
      dueAt: new Date(nextDueAt),
      lastCompletedAt: now,
      completedAt: now,
      completedById,
    }).where(eq(tasks.id, taskId)).run();
    return { completed: true, nextDueAt: new Date(nextDueAt) };
  }

  if (task.recurrenceType === "rrule") {
    if (!task.recurrenceRule || !task.baseDate) {
      throw Object.assign(new Error("Missing recurrence rule or base date"), {
        statusCode: 400, code: "INVALID_RECURRENCE",
      });
    }
    const effectiveDue = getNextOccurrence(task.recurrenceRule, task.lastCompletedAt || task.baseDate, task.baseDate);
    db.update(tasks).set({
      lastCompletedAt: now,
      completedAt: now,
      completedById,
    }).where(eq(tasks.id, taskId)).run();
    return { completed: true, nextDueAt: effectiveDue };
  }

  throw Object.assign(new Error("Unknown recurrence type"), { statusCode: 400, code: "UNKNOWN_RECURRENCE" });
}

export function reopenTask(taskId: string) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });

  if (task.recurrenceType !== "none") {
    throw Object.assign(new Error("Only one-time tasks can be reopened"), { statusCode: 400, code: "CANNOT_REOPEN" });
  }

  db.update(tasks).set({
    isCompleted: false,
    completedAt: null,
    completedById: null,
    lastCompletedAt: null,
  }).where(eq(tasks.id, taskId)).run();

  const evt = {
    id: uuid(),
    taskId,
    userId: task.completedById || task.createdById,
    type: "reopened" as const,
    content: null,
    createdAt: new Date(),
  };
  db.insert(taskEvents).values(evt).run();

  return { ok: true };
}

export function getTaskEvents(taskId: string) {
  const db = getDb();
  const rows = db.select({
    id: taskEvents.id,
    taskId: taskEvents.taskId,
    userId: taskEvents.userId,
    type: taskEvents.type,
    content: taskEvents.content,
    createdAt: taskEvents.createdAt,
    displayName: users.displayName,
  }).from(taskEvents)
    .leftJoin(users, eq(taskEvents.userId, users.id))
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.createdAt)
    .all();
  return rows;
}

export function addTaskComment(taskId: string, userId: string, content: string) {
  const db = getDb();
  const createdAt = new Date();
  const evt = {
    id: uuid(),
    taskId,
    userId,
    type: "comment" as const,
    content,
    createdAt,
  };
  db.insert(taskEvents).values(evt).run();
  const row = db.select({
    id: taskEvents.id,
    taskId: taskEvents.taskId,
    userId: taskEvents.userId,
    type: taskEvents.type,
    content: taskEvents.content,
    createdAt: taskEvents.createdAt,
    displayName: users.displayName,
  }).from(taskEvents)
    .leftJoin(users, eq(taskEvents.userId, users.id))
    .where(eq(taskEvents.id, evt.id))
    .get();
  return row || { ...evt, displayName: null };
}
