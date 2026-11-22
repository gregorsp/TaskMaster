import { z } from "zod";

/**
 * Einzige Quelle für die GTD-Werte (Service, Zod und KI-Prompt lesen von hier).
 * Referenzmaterial ist kein Status: der Klär-Assistent legt es als Notiz ab.
 */
export const TASK_STATUSES = ["next", "waiting", "someday"] as const;
/** Aufsteigend sortiert — `maxDuration` filtert über diese Reihenfolge. */
export const TASK_DURATIONS = ["under_2_min", "15_min", "30_min", "60_min", "long"] as const;
/** Aufsteigend sortiert — `maxEnergy` filtert über diese Reihenfolge. */
export const TASK_ENERGIES = ["low", "medium", "high"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskDuration = (typeof TASK_DURATIONS)[number];
export type TaskEnergy = (typeof TASK_ENERGIES)[number];

/**
 * Pomodoro-Schätzung (à 25 Min) aus der GTD-Dauer. Die Kapazitätsplanung nutzt
 * sie nur, wenn keine Pomodoros eingetragen sind – so braucht es keine
 * doppelte Aufwandsschätzung.
 */
export const DURATION_POMODOROS: Record<TaskDuration, number> = {
  under_2_min: 0,
  "15_min": 1,
  "30_min": 1,
  "60_min": 2,
  long: 4,
};

export function estimatedPomodoros(task: { pomodoros: number | null; duration: string | null }): number {
  if (task.pomodoros != null) return task.pomodoros;
  return task.duration && task.duration in DURATION_POMODOROS
    ? DURATION_POMODOROS[task.duration as TaskDuration]
    : 0;
}

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskDurationSchema = z.enum(TASK_DURATIONS);
export const taskEnergySchema = z.enum(TASK_ENERGIES);

export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullable().optional(),
  dueAt: z.string().nullable().optional(),
  isImportant: z.boolean().default(false),
  pomodoros: z.number().int().min(1).max(999).nullable().optional(),
  /**
   * Fehlt das Feld, wendet der Server die Nutzer-Voreinstellung an
   * (`users.default_private`, Standard: privat). Unteraufgaben erben die
   * Privatheit ihrer Elternaufgabe.
   */
  isPrivate: z.boolean().optional(),
  isHabit: z.boolean().default(false),
  status: taskStatusSchema.nullable().optional(),
  duration: taskDurationSchema.nullable().optional(),
  energy: taskEnergySchema.nullable().optional(),
  urgencyMode: z.enum(["never", "always", "before_days", "before_percent"]).default("before_days"),
  urgencyValue: z.number().int().min(1).max(99).optional().nullable(),
  recurrenceType: z.enum(["none", "rrule", "on_completion"]).default("none"),
  recurrenceRule: z.string().nullable().optional(),
  assigneeIds: z.array(z.string()).default([]),
  categoryIds: z.array(z.string()).default([]),
  contextIds: z.array(z.string()).default([]),
  parentId: z.string().nullable().optional(),
  plannedDate: z.string().nullable().optional(),
  /** Ziel (nur eigene Ziele); null löst die Verknüpfung. */
  goalId: z.string().nullable().optional(),
  forceDueDate: z.boolean().optional(),
  resolveDueDateConflicts: z.boolean().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  dueAt: z.string().nullable().optional(),
  isImportant: z.boolean().optional(),
  pomodoros: z.number().int().min(1).max(999).nullable().optional(),
  isPrivate: z.boolean().optional(),
  isHabit: z.boolean().optional(),
  status: taskStatusSchema.nullable().optional(),
  duration: taskDurationSchema.nullable().optional(),
  energy: taskEnergySchema.nullable().optional(),
  urgencyMode: z.enum(["never", "always", "before_days", "before_percent"]).optional(),
  urgencyValue: z.number().int().min(1).max(99).optional().nullable(),
  recurrenceType: z.enum(["none", "rrule", "on_completion"]).optional(),
  recurrenceRule: z.string().nullable().optional(),
  assigneeIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  contextIds: z.array(z.string()).optional(),
  parentId: z.string().nullable().optional(),
  plannedDate: z.string().nullable().optional(),
  /** Ziel (nur eigene Ziele); null löst die Verknüpfung. */
  goalId: z.string().nullable().optional(),
  forceUpdateRecurrence: z.boolean().optional(),
  forceDueDate: z.boolean().optional(),
  resolveDueDateConflicts: z.boolean().optional(),
});

export const completeTaskSchema = z.object({
  nextDueAt: z.string().optional(),
  comment: z.string().max(2000).optional(),
  force: z.boolean().optional(),
  cascade: z.boolean().optional(),
  occurrenceDate: z.string().optional(),
  recurringCompletions: z.record(z.string()).optional(),
});

export const reopenTaskSchema = z.object({
  occurrenceDate: z.string().optional(),
});

export const addLinkSchema = z.object({
  linkedTaskId: z.string().min(1),
});

export const commentSchema = z.object({
  content: z.string().min(1).max(2000),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
