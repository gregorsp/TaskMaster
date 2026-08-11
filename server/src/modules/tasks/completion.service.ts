import { eq, and } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { tasks, taskEvents, taskOccurrences, users } from "../../db/schema.js";
import { getNextOccurrence } from "../calendar/recurrence.service.js";
import { getProfilePictureUrl } from "../auth/profile.service.js";
import { getOpenSubtaskCount, collectDescendantIds } from "./tasks.service.js";

export async function completeTask(
  taskId: string,
  completedById: string,
  nextDueAt?: string,
  comment?: string,
  force?: boolean,
  cascade?: boolean,
  occurrenceDate?: string,
  recurringCompletions?: Record<string, string>
) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });

  const now = new Date();

  const parentId = task.parentId;

  if (task.isHabit) {
    const occDate = occurrenceDate
      ? new Date(new Date(occurrenceDate).getFullYear(), new Date(occurrenceDate).getMonth(), new Date(occurrenceDate).getDate())
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const existing = db.select().from(taskOccurrences)
      .where(and(eq(taskOccurrences.taskId, taskId), eq(taskOccurrences.occurrenceDate, occDate)))
      .get();

    if (existing) {
      db.update(taskOccurrences).set({
        isCompleted: true, completedAt: now, completedById, note: comment || null,
      }).where(eq(taskOccurrences.id, existing.id)).run();
    } else {
      db.insert(taskOccurrences).values({
        id: uuid(), taskId, occurrenceDate: occDate,
        isCompleted: true, completedAt: now, completedById,
        note: comment || null, createdAt: now,
      }).run();
    }

    db.update(tasks).set({ lastCompletedAt: now, completedAt: now, completedById })
      .where(eq(tasks.id, taskId)).run();

    const evtHabit = {
      id: uuid(),
      taskId,
      userId: completedById,
      type: "completed" as const,
      content: comment || null,
      occurrenceDate: occDate,
      createdAt: now,
    };
    db.insert(taskEvents).values(evtHabit).run();

    return { completed: true, nextDueAt: null, parentId };
  }

  const hasOpenSubtasks = getOpenSubtaskCount(taskId) > 0;

  if (cascade && hasOpenSubtasks) {
    const descendantIds = new Set<string>();
    collectDescendantIds(taskId, descendantIds);

    for (const id of descendantIds) {
      const subtask = db.select().from(tasks).where(eq(tasks.id, id)).get();
      if (!subtask || subtask.isCompleted) continue;

      const occStr = recurringCompletions?.[id];

      if (subtask.recurrenceType === "none") {
        db.update(tasks).set({
          isCompleted: true,
          completedAt: now,
          completedById,
          lastCompletedAt: now,
        }).where(eq(tasks.id, id)).run();

        db.insert(taskEvents).values({
          id: uuid(), taskId: id, userId: completedById,
          type: "completed", content: comment || null, createdAt: now,
        }).run();
      } else if (subtask.recurrenceType === "rrule" && occStr) {
        const occDate = new Date(occStr);
        const existing = db.select().from(taskOccurrences)
          .where(and(eq(taskOccurrences.taskId, id), eq(taskOccurrences.occurrenceDate, occDate)))
          .get();

        if (existing) {
          db.update(taskOccurrences).set({
            isCompleted: true, completedAt: now, completedById, note: comment || null,
          }).where(eq(taskOccurrences.id, existing.id)).run();
        } else {
          db.insert(taskOccurrences).values({
            id: uuid(), taskId: id, occurrenceDate: occDate,
            isCompleted: true, completedAt: now, completedById,
            note: comment || null, createdAt: now,
          }).run();
        }

        db.update(tasks).set({ lastCompletedAt: now, completedAt: now, completedById })
          .where(eq(tasks.id, id)).run();

        db.insert(taskEvents).values({
          id: uuid(), taskId: id, userId: completedById,
          type: "completed", content: comment || null, occurrenceDate: occDate, createdAt: now,
        }).run();
      }
    }
  } else if (!force && hasOpenSubtasks) {
    const openCount = getOpenSubtaskCount(taskId);
    throw Object.assign(new Error(`${openCount} subtask(s) still open`), {
      statusCode: 409, code: "SUBTASKS_OPEN", openCount,
    });
  }

  const evt = {
    id: uuid(),
    taskId,
    userId: completedById,
    type: "completed" as const,
    content: comment || null,
    occurrenceDate: task.recurrenceType === "rrule" && occurrenceDate ? new Date(occurrenceDate) : null,
    createdAt: now,
  };
  db.insert(taskEvents).values(evt).run();

  if (task.recurrenceType === "rrule") {
    if (occurrenceDate) {
      const occDate = new Date(occurrenceDate);
      const existing = db.select().from(taskOccurrences)
        .where(and(eq(taskOccurrences.taskId, taskId), eq(taskOccurrences.occurrenceDate, occDate)))
        .get();

      if (existing) {
        db.update(taskOccurrences).set({
          isCompleted: true, completedAt: now, completedById, note: comment || null,
        }).where(eq(taskOccurrences.id, existing.id)).run();
      } else {
        db.insert(taskOccurrences).values({
          id: uuid(), taskId, occurrenceDate: occDate,
          isCompleted: true, completedAt: now, completedById,
          note: comment || null, createdAt: now,
        }).run();
      }
    }

    if (!task.recurrenceRule || !task.baseDate) {
      throw Object.assign(new Error("Missing recurrence rule or base date"), {
        statusCode: 400, code: "INVALID_RECURRENCE",
      });
    }
    const effectiveDue = getNextOccurrence(task.recurrenceRule, task.lastCompletedAt || task.baseDate, task.baseDate);
    db.update(tasks).set({
      lastCompletedAt: now, completedAt: now, completedById,
    }).where(eq(tasks.id, taskId)).run();
    return { completed: true, nextDueAt: effectiveDue, parentId };
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
    return { completed: true, nextDueAt: new Date(nextDueAt), parentId };
  }

  db.update(tasks).set({
    isCompleted: true,
    completedAt: now,
    completedById,
    lastCompletedAt: now,
  }).where(eq(tasks.id, taskId)).run();
  return { completed: true, nextDueAt: null, parentId };
}

export function reopenTask(taskId: string, occurrenceDate?: string) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw Object.assign(new Error("Task not found"), { statusCode: 404, code: "NOT_FOUND" });

  if (task.isHabit) {
    const occDate = occurrenceDate
      ? new Date(occurrenceDate)
      : new Date(task.lastCompletedAt ?? new Date());
    const occDay = new Date(occDate.getFullYear(), occDate.getMonth(), occDate.getDate());

    const existing = db.select().from(taskOccurrences)
      .where(and(eq(taskOccurrences.taskId, taskId), eq(taskOccurrences.occurrenceDate, occDay)))
      .get();
    if (existing) {
      db.update(taskOccurrences).set({
        isCompleted: false, completedAt: null, completedById: null,
      }).where(eq(taskOccurrences.id, existing.id)).run();
    }

    const evt = {
      id: uuid(),
      taskId,
      userId: task.completedById || task.createdById,
      type: "reopened" as const,
      content: null,
      occurrenceDate: occDay,
      createdAt: new Date(),
    };
    db.insert(taskEvents).values(evt).run();

    return { ok: true };
  }

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
    occurrenceDate: taskEvents.occurrenceDate,
    createdAt: taskEvents.createdAt,
    displayName: users.displayName,
    profilePicture: users.profilePicture,
  }).from(taskEvents)
    .leftJoin(users, eq(taskEvents.userId, users.id))
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.createdAt)
    .all();
  return rows.map((r) => ({ ...r, profilePicture: getProfilePictureUrl(r.profilePicture) }));
}

export function addTaskComment(taskId: string, userId: string, content: string) {
  const db = getDb();
  const evt = {
    id: uuid(),
    taskId,
    userId,
    type: "comment" as const,
    content,
    createdAt: new Date(),
  };
  db.insert(taskEvents).values(evt).run();
  return evt;
}
