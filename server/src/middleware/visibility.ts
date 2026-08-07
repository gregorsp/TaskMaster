import { and, or, eq, SQL } from "drizzle-orm";
import { tasks, taskAssignees } from "../db/schema.js";
import { getDb } from "../db/client.js";

export function visibilityFilter(userId: string, isAdmin: boolean): SQL | undefined {
  if (isAdmin) return undefined;
  return or(
    eq(tasks.isPrivate, false),
    eq(tasks.createdById, userId),
    eq(taskAssignees.userId, userId)
  );
}

export async function isVisibleToUser(taskId: string, userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;

  const db = getDb();
  const result = db
    .select({ isPrivate: tasks.isPrivate, createdById: tasks.createdById })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();

  if (!result || !result.isPrivate) return true;
  if (result.createdById === userId) return true;

  const assignee = db
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
    .get();

  return !!assignee;
}
