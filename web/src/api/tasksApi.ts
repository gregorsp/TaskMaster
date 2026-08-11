import client from "./client";

export interface TaskAssignee {
  id: string;
  username: string;
  displayName: string;
  profilePicture: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  baseDate: string | null;
  lastCompletedAt: string | null;
  effectiveDueAt: string | null;
  isOverdue: boolean;
  isCompleted: boolean;
  completedAt: string | null;
  completedById: string | null;
  isImportant: boolean;
  isUrgent: boolean;
  pomodoros: number | null;
  urgencyMode: "never" | "always" | "before_days" | "before_percent";
  urgencyValue: number | null;
  isPrivate: boolean;
  recurrenceType: "none" | "rrule" | "on_completion";
  recurrenceRule: string | null;
  parentId: string | null;
  plannedDate: string | null;
  createdById: string;
  createdAt: string;
  assignees: TaskAssignee[];
}

export interface TaskWithRelations extends Task {
  categories: { id: string; name: string; color: string }[];
}

export interface SubtaskProgress {
  completed: number;
  total: number;
}

export interface SubtaskResponse {
  subtasks: Task[];
  progress: SubtaskProgress;
}

export interface TaskListResponse {
  items: Task[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TaskFilters {
  isCompleted?: boolean;
  categoryId?: string;
  assigneeId?: string;
  assigneeIds?: string[];
  isOverdue?: boolean;
  important?: boolean;
  urgent?: boolean;
  search?: string;
  sort?: "createdAt" | "dueAt" | "title";
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  dueAt?: string;
  isImportant?: boolean;
  pomodoros?: number | null;
  isPrivate?: boolean;
  urgencyMode?: "never" | "always" | "before_days" | "before_percent";
  urgencyValue?: number | null;
  recurrenceType?: "none" | "rrule" | "on_completion";
  recurrenceRule?: string;
  assigneeIds?: string[];
  categoryIds?: string[];
  parentId?: string | null;
  plannedDate?: string | null;
}

export interface OccurrenceInfo {
  date: string;
  iso: string;
  isCompleted: boolean;
  completedAt: string | null;
  isPlanned: boolean;
  plannedDate: string | null;
}

export interface TaskOccurrence {
  id: string;
  taskId: string;
  occurrenceDate: string;
  plannedDate: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  completedById: string | null;
  note: string | null;
  createdAt: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  dueAt?: string | null;
  isImportant?: boolean;
  isUrgent?: boolean;
  pomodoros?: number | null;
  isPrivate?: boolean;
  urgencyMode?: "never" | "always" | "before_days" | "before_percent";
  urgencyValue?: number | null;
  recurrenceType?: "none" | "rrule" | "on_completion";
  recurrenceRule?: string | null;
  assigneeIds?: string[];
  categoryIds?: string[];
  parentId?: string | null;
  plannedDate?: string | null;
  forceUpdateRecurrence?: boolean;
}

export async function listTasks(filters: TaskFilters = {}): Promise<TaskListResponse> {
  const params = new URLSearchParams();
  if (filters.isCompleted !== undefined) params.set("isCompleted", String(filters.isCompleted));
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (filters.assigneeIds && filters.assigneeIds.length > 0) params.set("assigneeIds", filters.assigneeIds.join(","));
  if (filters.isOverdue !== undefined) params.set("isOverdue", String(filters.isOverdue));
  if (filters.important !== undefined) params.set("important", String(filters.important));
  if (filters.urgent !== undefined) params.set("urgent", String(filters.urgent));
  if (filters.search) params.set("search", filters.search);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.order) params.set("order", filters.order);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  const qs = params.toString();
  const { data } = await client.get<TaskListResponse>(`/tasks${qs ? `?${qs}` : ""}`);
  return data;
}

export async function getTask(id: string): Promise<TaskWithRelations> {
  const { data } = await client.get<TaskWithRelations>(`/tasks/${id}`);
  return data;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const { data } = await client.post<Task>("/tasks", input);
  return data;
}

export async function updateTask(id: string, input: UpdateTaskInput): Promise<TaskWithRelations> {
  const { data } = await client.put<TaskWithRelations>(`/tasks/${id}`, input);
  return data;
}

export async function deleteTask(id: string): Promise<void> {
  await client.delete(`/tasks/${id}`);
}

export async function completeTask(id: string, nextDueAt?: string, comment?: string, force?: boolean, cascade?: boolean, occurrenceDate?: string, recurringCompletions?: Record<string, string>): Promise<{ completed: boolean; nextDueAt: string | null; parentId: string | null }> {
  const { data } = await client.post<{ completed: boolean; nextDueAt: string | null; parentId: string | null }>(`/tasks/${id}/complete`, { nextDueAt, comment, force, cascade, occurrenceDate, recurringCompletions });
  return data;
}

export async function reopenTask(id: string): Promise<void> {
  await client.post(`/tasks/${id}/reopen`);
}

export async function getSubtasks(id: string): Promise<SubtaskResponse> {
  const { data } = await client.get<Partial<SubtaskResponse>>(`/tasks/${id}/subtasks`);
  return {
    subtasks: Array.isArray(data?.subtasks) ? (data.subtasks as Task[]) : [],
    progress: { completed: data?.progress?.completed ?? 0, total: data?.progress?.total ?? 0 },
  };
}

export async function getSiblings(id: string): Promise<Task[]> {
  const { data } = await client.get<Task[]>(`/tasks/${id}/siblings`);
  return Array.isArray(data) ? data : [];
}

export async function getTaskLinks(id: string): Promise<Task[]> {
  const { data } = await client.get<Task[]>(`/tasks/${id}/links`);
  return Array.isArray(data) ? data : [];
}

export async function addTaskLink(id: string, linkedTaskId: string): Promise<{ ok: boolean }> {
  const { data } = await client.post<{ ok: boolean }>(`/tasks/${id}/links`, { linkedTaskId });
  return data;
}

export async function removeTaskLink(id: string, linkedTaskId: string): Promise<{ ok: boolean }> {
  const { data } = await client.delete<{ ok: boolean }>(`/tasks/${id}/links/${linkedTaskId}`);
  return data;
}

export async function getTaskOccurrences(id: string): Promise<TaskOccurrence[]> {
  const { data } = await client.get<TaskOccurrence[]>(`/tasks/${id}/occurrences`);
  return Array.isArray(data) ? data : [];
}

export async function getUpcomingOccurrences(id: string, count = 3, showPast = false): Promise<OccurrenceInfo[]> {
  const params = new URLSearchParams({ count: String(count), showPast: String(showPast) });
  const { data } = await client.get<OccurrenceInfo[]>(`/tasks/${id}/upcoming-occurrences?${params}`);
  return Array.isArray(data) ? data : [];
}

export async function createTaskOccurrence(id: string, occurrenceDate: string, plannedDate: string | null): Promise<TaskOccurrence> {
  const { data } = await client.post<TaskOccurrence>(`/tasks/${id}/occurrences`, { occurrenceDate, plannedDate });
  return data;
}

export async function deleteTaskOccurrence(taskId: string, occurrenceId: string): Promise<void> {
  await client.delete(`/tasks/${taskId}/occurrences/${occurrenceId}`);
}
