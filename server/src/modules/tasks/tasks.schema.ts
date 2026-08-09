import { z } from "zod";

export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  dueAt: z.string().optional(),
  isImportant: z.boolean().default(false),
  pomodoros: z.number().int().min(1).max(999).nullable().optional(),
  isPrivate: z.boolean().default(false),
  urgencyMode: z.enum(["never", "always", "before_days", "before_percent"]).default("before_days"),
  urgencyValue: z.number().int().min(1).max(99).optional().nullable(),
  recurrenceType: z.enum(["none", "rrule", "on_completion"]).default("none"),
  recurrenceRule: z.string().optional(),
  assigneeIds: z.array(z.string()).default([]),
  categoryIds: z.array(z.string()).default([]),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  dueAt: z.string().nullable().optional(),
  isImportant: z.boolean().optional(),
  pomodoros: z.number().int().min(1).max(999).nullable().optional(),
  isPrivate: z.boolean().optional(),
  urgencyMode: z.enum(["never", "always", "before_days", "before_percent"]).optional(),
  urgencyValue: z.number().int().min(1).max(99).optional().nullable(),
  recurrenceType: z.enum(["none", "rrule", "on_completion"]).optional(),
  recurrenceRule: z.string().nullable().optional(),
  assigneeIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
