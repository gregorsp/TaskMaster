import { and, or, eq, SQL } from "drizzle-orm";
import { tasks, taskAssignees } from "../db/schema.js";
import { getDb } from "../db/client.js";

/**
 * Sichtbarkeitsfilter für Aufgaben.
 *
 * Es gibt bewusst **keinen Admin-Bypass** mehr: Auch ein Admin sieht eine
 * private Aufgabe nur, wenn er ihr Ersteller oder ihr zugewiesen ist. Der
 * zweite Parameter bleibt nur aus Kompatibilität erhalten und wird ignoriert.
 */
export function visibilityFilter(userId: string, _isAdmin?: boolean): SQL {
  return or(
    eq(tasks.isPrivate, false),
    eq(tasks.createdById, userId),
    eq(taskAssignees.userId, userId)
  ) as SQL;
}

/**
 * Synchrone Sichtbarkeitsprüfung (die Datenbank ist ohnehin in-memory).
 * Fail-closed: Eine unbekannte Task-ID gilt als nicht sichtbar.
 */
export function isVisibleToUserSync(taskId: string, userId: string): boolean {
  const db = getDb();
  const result = db
    .select({ isPrivate: tasks.isPrivate, createdById: tasks.createdById })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();

  if (!result) return false;
  if (!result.isPrivate) return true;
  if (result.createdById === userId) return true;

  const assignee = db
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
    .get();

  return !!assignee;
}

export async function isVisibleToUser(taskId: string, userId: string, _isAdmin?: boolean): Promise<boolean> {
  return isVisibleToUserSync(taskId, userId);
}
