import { crudApi } from "./crud";
import type { TaskEnergy, TaskStatus } from "./tasksApi";

/* Ziele und Zeitblöcke: die GTD-Ebenen über bzw. neben den Projekten. */

export interface GoalTaskRef {
  id: string;
  title: string;
  status: TaskStatus | null;
  isCompleted: boolean;
  isProject: boolean;
  nextStep: { id: string; title: string } | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  targetDate: string | null;
  achievedAt: string | null;
  createdAt: string;
  tasks: GoalTaskRef[];
  openCount: number;
  doneCount: number;
}

export interface GoalInput {
  title: string;
  description?: string | null;
  targetDate?: string | null;
  achieved?: boolean;
}

export const goalsApi = crudApi<Goal, GoalInput>("/goals");

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Montag", tue: "Dienstag", wed: "Mittwoch", thu: "Donnerstag", fri: "Freitag", sat: "Samstag", sun: "Sonntag",
};

export interface TimeBlock {
  id: string;
  weekday: Weekday;
  startMinute: number;
  endMinute: number;
  title: string;
  contextId: string | null;
  energy: TaskEnergy | null;
}

export interface TimeBlockFields {
  startMinute: number;
  endMinute: number;
  title: string;
  contextId?: string | null;
  energy?: TaskEnergy | null;
}

export const timeBlocksApi = crudApi<
  TimeBlock,
  TimeBlockFields & { weekdays: Weekday[] },
  Partial<TimeBlockFields & { weekday: Weekday }>,
  TimeBlock[]
>("/time-blocks");

/** JS-Wochentag (So = 0) → Kürzel der API. */
export function weekdayOf(date: Date): Weekday {
  return WEEKDAYS[(date.getDay() + 6) % 7];
}

export const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes();

export function formatMinutes(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function parseTime(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
