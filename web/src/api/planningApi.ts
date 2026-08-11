import client from "./client";

export interface LoadDayTask {
  id: string;
  title: string;
  pomodoros: number;
  type: "due" | "planned";
}

export interface LoadDay {
  date: string;
  weekday: string;
  capacity: number;
  usedSp: number;
  taskCount: number;
  overloaded: boolean;
  tasks: LoadDayTask[];
}

export interface HorizonWarning {
  deadlineDate: string;
  requiredSp: number;
  availableSp: number;
  shortfall: number;
}

export interface PlanningDraft {
  changes: Record<string, string | null>;
  lastModified: string;
}

export interface PlanningData {
  tasks: import("./tasksApi").Task[];
  days: LoadDay[];
  draft: PlanningDraft | null;
  horizonWarnings: HorizonWarning[];
}

export async function fetchPlanning(from: string, to: string, userId?: string): Promise<PlanningData> {
  const params = new URLSearchParams({ from, to });
  if (userId) params.set("userId", userId);
  const { data } = await client.get<PlanningData>(`/planning?${params}`);
  return data;
}

export async function saveDraft(changes: Record<string, string | null>): Promise<PlanningDraft> {
  const { data } = await client.put<PlanningDraft>("/planning/draft", { changes });
  return data;
}

export async function discardDraft(): Promise<void> {
  await client.delete("/planning/draft");
}

export async function confirmPlanning(): Promise<{ updated: number }> {
  const { data } = await client.post<{ updated: number }>("/planning/confirm");
  return data;
}
