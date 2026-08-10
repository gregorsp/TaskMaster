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
  parentId: string | null;
  isImportant: boolean;
  isUrgent: boolean;
  pomodoros: number | null;
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

export interface Subtask {
  id: string;
  title: string;
  pomodoros: number | null;
  isCompleted: boolean;
  isOverdue: boolean;
  dueAt: string | null;
  subtaskCount: number;
  assignees: TaskAssignee[];
}

export interface SubtaskResponse {
  subtasks: Subtask[];
  progress: { completed: number; total: number };
}

export interface LinkedTask {
  id: string;
  title: string;
  pomodoros: number | null;
  isCompleted: boolean;
  isPrivate: boolean;
  dueAt: string | null;
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
  parentId?: string;
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
  parentId?: string;
  assigneeIds?: string[];
  categoryIds?: string[];
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
  parentId?: string | null;
  assigneeIds?: string[];
  categoryIds?: string[];
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
  if (filters.parentId !== undefined) params.set("parentId", filters.parentId);
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

export async function completeTask(id: string, nextDueAt?: string, comment?: string, forceCompleteSubtasks = false): Promise<{ completed: boolean; nextDueAt: string | null }> {
  const { data } = await client.post<{ completed: boolean; nextDueAt: string | null }>(`/tasks/${id}/complete`, { nextDueAt, comment, forceCompleteSubtasks });
  return data;
}

export async function reopenTask(id: string): Promise<void> {
  await client.post(`/tasks/${id}/reopen`);
}

export async function getSubtasks(id: string): Promise<SubtaskResponse> {
  const { data } = await client.get<SubtaskResponse>(`/tasks/${id}/subtasks`);
  return data;
}

export async function getTaskLinks(id: string): Promise<LinkedTask[]> {
  const { data } = await client.get<LinkedTask[]>(`/tasks/${id}/links`);
  return data;
}

export async function addTaskLink(id: string, linkedTaskId: string): Promise<void> {
  await client.post(`/tasks/${id}/links`, { linkedTaskId });
}

export async function removeTaskLink(id: string, linkedTaskId: string): Promise<void> {
  await client.delete(`/tasks/${id}/links/${linkedTaskId}`);
}

export interface LinkPair {
  a: string;
  b: string;
}

export async function getAllLinks(): Promise<LinkPair[]> {
  const { data } = await client.get<LinkPair[]>("/tasks/links");
  return data;
}

export interface RelationNode {
  id: string;
  title: string;
  pomodoros: number | null;
  isCompleted: boolean;
  parentId: string | null;
}

export interface TaskRelationsResponse {
  ancestors: RelationNode[];
  current: RelationNode | null;
  descendants: RelationNode[];
  links: Record<string, RelationNode[]>;
}

export async function getTaskRelations(id: string): Promise<TaskRelationsResponse> {
  const { data } = await client.get<TaskRelationsResponse>(`/tasks/${id}/relations`);
  return data;
}
