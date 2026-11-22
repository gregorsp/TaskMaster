import { eq } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { contexts, timeBlocks } from "../../db/schema.js";
import { WEEKDAYS } from "../../lib/capacity.js";
import { findOwned } from "../../lib/owned.js";
import type { TaskEnergy } from "../tasks/tasks.schema.js";
import type { Weekday } from "../../lib/capacity.js";

export interface TimeBlockInput {
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
  title: string;
  contextId?: string | null;
  energy?: TaskEnergy | null;
}

function invalid(message: string) {
  return Object.assign(new Error(message), { statusCode: 400, code: "INVALID_TIME_BLOCK" });
}

/** Zeit und Kontext prüfen (Kontext muss dem Nutzer gehören). */
function validate(input: Partial<TimeBlockInput>, userId: string, current?: { startMinute: number; endMinute: number }) {
  const start = input.startMinute ?? current?.startMinute ?? 0;
  const end = input.endMinute ?? current?.endMinute ?? 0;
  if (end <= start) throw invalid("Das Ende muss nach dem Beginn liegen.");
  if (input.contextId) {
    const ctx = getDb().select({ owner: contexts.createdById }).from(contexts).where(eq(contexts.id, input.contextId)).get();
    if (!ctx || ctx.owner !== userId) throw invalid("Unbekannter Kontext.");
  }
}

/** Eigene Zeitblöcke, sortiert nach Wochentag (Mo–So) und Beginn. */
export function listTimeBlocks(userId: string) {
  const order = (d: string) => WEEKDAYS.indexOf(d as Weekday);
  return getDb().select().from(timeBlocks).where(eq(timeBlocks.userId, userId)).all()
    .sort((a, b) => order(a.weekday) - order(b.weekday) || a.startMinute - b.startMinute);
}

export function createTimeBlocks(userId: string, weekdays: Weekday[], input: Omit<TimeBlockInput, "weekday">) {
  validate(input, userId);
  const now = new Date();
  const rows = [...new Set(weekdays)].map((weekday) => ({
    id: uuid(), userId, weekday, createdAt: now,
    startMinute: input.startMinute, endMinute: input.endMinute, title: input.title.trim(),
    contextId: input.contextId ?? null, energy: input.energy ?? null,
  }));
  if (rows.length) getDb().insert(timeBlocks).values(rows).run();
  return rows;
}

export function updateTimeBlock(id: string, userId: string, input: Partial<TimeBlockInput>) {
  const current = findOwned(timeBlocks, id, userId, "Time block");
  validate(input, userId, current);
  const patch = { ...input, ...(input.title !== undefined ? { title: input.title.trim() } : {}) };
  if (Object.keys(patch).length) getDb().update(timeBlocks).set(patch).where(eq(timeBlocks.id, id)).run();
  return findOwned(timeBlocks, id, userId, "Time block");
}

export function deleteTimeBlock(id: string, userId: string) {
  findOwned(timeBlocks, id, userId, "Time block");
  getDb().delete(timeBlocks).where(eq(timeBlocks.id, id)).run();
}
