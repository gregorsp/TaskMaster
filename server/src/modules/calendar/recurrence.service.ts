import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RRule } = require("rrule") as typeof import("rrule");

export interface TaskLike {
  recurrenceType: string;
  recurrenceRule: string | null;
  dueAt: Date | null;
  baseDate: Date | null;
  lastCompletedAt: Date | null;
  isCompleted: boolean;
  urgencyMode: string;
  urgencyValue: number | null;
  createdAt: Date;
}

export function getOccurrences(ruleStr: string, from: Date, to: Date, referenceDate: Date): Date[] {
  try {
    const base = RRule.parseString(ruleStr);
    const rule = new RRule({ ...base, dtstart: referenceDate });
    return rule.between(from, to, true);
  } catch { return []; }
}

export function getNextOccurrence(ruleStr: string, after: Date, referenceDate: Date): Date | null {
  try {
    const base = RRule.parseString(ruleStr);
    const rule = new RRule({ ...base, dtstart: referenceDate });
    return rule.after(after, true) || null;
  } catch { return null; }
}

export function getFirstOccurrence(ruleStr: string, baseDate: Date): Date | null {
  try {
    const base = RRule.parseString(ruleStr);
    const rule = new RRule({ ...base, dtstart: baseDate });
    return rule.after(new Date(0), true) || null;
  } catch { return baseDate; }
}

export function getEffectiveDueAt(task: TaskLike): Date | null {
  if (task.recurrenceType === "rrule" && task.recurrenceRule && task.baseDate) {
    return getNextOccurrence(task.recurrenceRule, new Date(), task.baseDate);
  }
  return task.dueAt;
}

export function isTaskOverdue(task: TaskLike): boolean {
  const now = new Date();
  if (task.isCompleted) return false;
  if (task.recurrenceType === "rrule" && task.recurrenceRule && task.baseDate) {
    if (!task.lastCompletedAt) {
      const first = getFirstOccurrence(task.recurrenceRule, task.baseDate);
      return first !== null && first < now;
    }
    const next = getNextOccurrence(task.recurrenceRule, task.lastCompletedAt, task.baseDate);
    return next !== null && next < now;
  }
  if (task.recurrenceType === "on_completion" && task.dueAt) {
    return new Date(task.dueAt) < now;
  }
  if (task.recurrenceType === "none" && task.dueAt) {
    return new Date(task.dueAt) < now;
  }
  return false;
}

export function computeIsUrgent(task: TaskLike): boolean {
  if (task.urgencyMode === "always") return true;
  if (task.urgencyMode === "never") return false;
  const effectiveDue = getEffectiveDueAt(task);
  if (!effectiveDue) return false;
  const now = new Date();
  if (task.urgencyMode === "before_days") {
    const days = task.urgencyValue ?? 3;
    return effectiveDue.getTime() - now.getTime() <= days * 86400000;
  }
  if (task.urgencyMode === "before_percent") {
    const pct = task.urgencyValue ?? 50;
    const created = task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt);
    const total = effectiveDue.getTime() - created.getTime();
    const elapsed = now.getTime() - created.getTime();
    return total > 0 && (elapsed / total) * 100 >= pct;
  }
  return false;
}
