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
  urgencyMode: "never" | "always" | "before_days" | "before_percent";
  urgencyValue: number | null;
  isPrivate: boolean;
  recurrenceType: "none" | "rrule" | "on_completion";
  recurrenceRule: string | null;
  createdById: string;
  createdAt: string;
  assignees: TaskAssignee[];
}

export interface TaskWithRelations extends Task {
  categories: { id: string; name: string; color: string }[];
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
  isPrivate?: boolean;
  urgencyMode?: "never" | "always" | "before_days" | "before_percent";
  urgencyValue?: number | null;
  recurrenceType?: "none" | "rrule" | "on_completion";
  recurrenceRule?: string;
  assigneeIds?: string[];
  categoryIds?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  dueAt?: string | null;
  isImportant?: boolean;
  isUrgent?: boolean;
  isPrivate?: boolean;
  urgencyMode?: "never" | "always" | "before_days" | "before_percent";
  urgencyValue?: number | null;
  recurrenceType?: "none" | "rrule" | "on_completion";
  recurrenceRule?: string | null;
  assigneeIds?: string[];
  categoryIds?: string[];
}

export async function listTasks(filters: TaskFilters = {}): Promise<TaskListResponse> {
  const params = new URLSearchParams();
  if (filters.isCompleted !== undefined) params.set("isCompleted", String(filters.isCompleted));
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
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

export async function completeTask(id: string, nextDueAt?: string, comment?: string): Promise<{ completed: boolean; nextDueAt: string | null }> {
  const { data } = await client.post<{ completed: boolean; nextDueAt: string | null }>(`/tasks/${id}/complete`, { nextDueAt, comment });
  return data;
}

export async function reopenTask(id: string): Promise<void> {
  await client.post(`/tasks/${id}/reopen`);
}

export async function listOverdueTasks(): Promise<{ items: Task[]; total: number }> {
  const { data } = await client.get<{ items: Task[]; total: number }>("/tasks/overdue");
  return data;
}
