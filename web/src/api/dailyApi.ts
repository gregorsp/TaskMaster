import client from "./client";
import type { Task } from "./tasksApi";

export interface DailyHabit {
  id: string;
  title: string;
  description: string | null;
  isImportant: boolean;
  pomodoros: number | null;
  categories: { id: string; name: string; color: string }[];
  assignees: { id: string; username: string; displayName: string; profilePicture: string | null }[];
  completedOnDate: boolean;
  completedAt: string | null;
}

export interface DailyTask {
  task: Task;
  categories: { id: string; name: string; color: string }[];
  assignees: { id: string; username: string; displayName: string; profilePicture: string | null }[];
  type: "due" | "planned";
  occurrenceId: string | null;
  occurrenceDate: string | null;
}

export interface DailyData {
  date: string;
  habits: DailyHabit[];
  tasks: DailyTask[];
}

export async function fetchDaily(date?: string): Promise<DailyData> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  const qs = params.toString();
  const { data } = await client.get<DailyData>(`/daily${qs ? `?${qs}` : ""}`);
  return data;
}
