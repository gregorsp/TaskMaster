import { eq, inArray } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { goals, tasks } from "../../db/schema.js";
import { findOwned } from "../../lib/owned.js";
import { listVisibleTasks } from "../tasks/tasks.service.js";

export interface GoalInput {
  title?: string;
  description?: string | null;
  targetDate?: string | null;
  achieved?: boolean;
}

/**
 * Eigene Ziele samt verknüpfter (sichtbarer) Aufgaben/Projekte.
 * Offene Ziele zuerst (nach Zieldatum, dann Anlage), erreichte zuletzt.
 */
export function listGoals(userId: string) {
  const rows = getDb().select().from(goals).where(eq(goals.userId, userId)).all();
  const linked = rows.length ? listVisibleTasks(userId, inArray(tasks.goalId, rows.map((g) => g.id))) : [];

  const time = (d: Date | null) => (d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER);
  return rows
    .sort((a, b) =>
      Number(!!a.achievedAt) - Number(!!b.achievedAt)
      || time(a.targetDate) - time(b.targetDate)
      || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((goal) => {
      const items = linked.filter((t) => t.goalId === goal.id);
      return {
        ...goal,
        tasks: items.map((t) => ({
          id: t.id, title: t.title, status: t.status, isCompleted: t.isCompleted, isProject: t.isProject, nextStep: t.nextStep,
        })),
        openCount: items.filter((t) => !t.isCompleted).length,
        doneCount: items.filter((t) => t.isCompleted).length,
      };
    });
}

function toPatch(input: GoalInput) {
  const patch: Partial<typeof goals.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.targetDate !== undefined) patch.targetDate = input.targetDate ? new Date(input.targetDate) : null;
  if (input.achieved !== undefined) patch.achievedAt = input.achieved ? new Date() : null;
  return patch;
}

export function createGoal(userId: string, input: GoalInput & { title: string }) {
  const goal = { id: uuid(), userId, createdAt: new Date(), title: "", ...toPatch(input) };
  getDb().insert(goals).values(goal).run();
  return findOwned(goals, goal.id, userId, "Goal");
}

export function updateGoal(id: string, userId: string, input: GoalInput) {
  findOwned(goals, id, userId, "Goal");
  const patch = toPatch(input);
  if (Object.keys(patch).length) getDb().update(goals).set(patch).where(eq(goals.id, id)).run();
  return findOwned(goals, id, userId, "Goal");
}

/** Löscht das Ziel; verknüpfte Aufgaben bleiben, nur die Verknüpfung fällt weg. */
export function deleteGoal(id: string, userId: string) {
  findOwned(goals, id, userId, "Goal");
  const db = getDb();
  db.update(tasks).set({ goalId: null }).where(eq(tasks.goalId, id)).run();
  db.delete(goals).where(eq(goals.id, id)).run();
}
