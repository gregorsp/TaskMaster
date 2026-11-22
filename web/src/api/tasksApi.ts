import client from "./client";

export interface TaskAssignee {
  id: string;
  username: string;
  displayName: string;
  profilePicture: string | null;
}

export interface TaskCategoryRef {
  id: string;
  name: string;
  color: string;
  createdById?: string;
}

export interface TaskContextRef {
  id: string;
  name: string;
  color: string;
  createdById?: string;
}

// Werte spiegeln server/src/modules/tasks/tasks.schema.ts; Labels in components/tasks/gtd.ts.
export type TaskStatus = "next" | "waiting" | "someday";
/** Aufsteigend: „verfügbare Zeit“ filtert über `maxDuration`. */
export type TaskDuration = "under_2_min" | "15_min" | "30_min" | "60_min" | "long";
/** Aufsteigend: „verfügbare Energie“ filtert über `maxEnergy`. */
export type TaskEnergy = "low" | "medium" | "high";

export interface Task {
  id: string;
  slug: string | null;
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
  isHabit: boolean;
  status: TaskStatus | null;
  duration: TaskDuration | null;
  energy: TaskEnergy | null;
  recurrenceType: "none" | "rrule" | "on_completion";
  recurrenceRule: string | null;
  parentId: string | null;
  plannedDate: string | null;
  goalId: string | null;
  createdById: string;
  createdAt: string;
  assignees: TaskAssignee[];
  categories: TaskCategoryRef[];
  contexts: TaskContextRef[];
  isProject?: boolean;
  /** Bei Projekten: der aktuelle Nächste Schritt (rückt beim Erledigen automatisch nach). */
  nextStep?: { id: string; title: string } | null;
}

export type TaskWithRelations = Task;

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
  contextId?: string;
  uncategorized?: boolean;
  assigneeId?: string;
  assigneeIds?: string[];
  isOverdue?: boolean;
  important?: boolean;
  urgent?: boolean;
  isHabit?: boolean;
  status?: TaskStatus | "none";
  duration?: TaskDuration | "none";
  energy?: TaskEnergy | "none";
  /** Höchstens so lange (Aufgaben ohne Dauer bleiben sichtbar). */
  maxDuration?: TaskDuration;
  /** Höchstens so viel Energie (Aufgaben ohne Angabe bleiben sichtbar). */
  maxEnergy?: TaskEnergy;
  isProject?: boolean;
  search?: string;
  hidePlanned?: boolean;
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
  isHabit?: boolean;
  status?: TaskStatus | null;
  duration?: TaskDuration | null;
  energy?: TaskEnergy | null;
  urgencyMode?: "never" | "always" | "before_days" | "before_percent";
  urgencyValue?: number | null;
  recurrenceType?: "none" | "rrule" | "on_completion";
  recurrenceRule?: string;
  assigneeIds?: string[];
  categoryIds?: string[];
  contextIds?: string[];
  parentId?: string | null;
  plannedDate?: string | null;
  goalId?: string | null;
  forceDueDate?: boolean;
  resolveDueDateConflicts?: boolean;
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
  isHabit?: boolean;
  status?: TaskStatus | null;
  duration?: TaskDuration | null;
  energy?: TaskEnergy | null;
  urgencyMode?: "never" | "always" | "before_days" | "before_percent";
  urgencyValue?: number | null;
  recurrenceType?: "none" | "rrule" | "on_completion";
  recurrenceRule?: string | null;
  assigneeIds?: string[];
  categoryIds?: string[];
  contextIds?: string[];
  parentId?: string | null;
  plannedDate?: string | null;
  goalId?: string | null;
  forceUpdateRecurrence?: boolean;
  forceDueDate?: boolean;
  resolveDueDateConflicts?: boolean;
}

export async function listTasks(filters: TaskFilters = {}): Promise<TaskListResponse> {
  const params = new URLSearchParams();
  if (filters.isCompleted !== undefined) params.set("isCompleted", String(filters.isCompleted));
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.contextId) params.set("contextId", filters.contextId);
  if (filters.status) params.set("status", filters.status);
  if (filters.duration) params.set("duration", filters.duration);
  if (filters.energy) params.set("energy", filters.energy);
  if (filters.maxDuration) params.set("maxDuration", filters.maxDuration);
  if (filters.maxEnergy) params.set("maxEnergy", filters.maxEnergy);
  if (filters.isProject !== undefined) params.set("isProject", String(filters.isProject));
  if (filters.uncategorized) params.set("uncategorized", "true");
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (filters.assigneeIds && filters.assigneeIds.length > 0) params.set("assigneeIds", filters.assigneeIds.join(","));
  if (filters.isOverdue !== undefined) params.set("isOverdue", String(filters.isOverdue));
  if (filters.important !== undefined) params.set("important", String(filters.important));
  if (filters.urgent !== undefined) params.set("urgent", String(filters.urgent));
  if (filters.isHabit !== undefined) params.set("isHabit", String(filters.isHabit));
  if (filters.search) params.set("search", filters.search);
  if (filters.hidePlanned) params.set("hidePlanned", "true");
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.order) params.set("order", filters.order);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  const qs = params.toString();
  const { data } = await client.get<TaskListResponse>(`/tasks${qs ? `?${qs}` : ""}`);
  return data;
}

export interface WeeklyReview {
  inboxCount: number;
  somedayCount: number;
  /** Offene Ziele ohne offene, verknüpfte Aufgabe. */
  idleGoals: { id: string; title: string }[];
  /** Offene Projekte ohne offenen Nächsten Schritt. */
  stalledProjects: Task[];
  /** „Warten auf“-Einträge, älteste zuerst. */
  waiting: Task[];
}

export async function getWeeklyReview(): Promise<WeeklyReview> {
  const { data } = await client.get<WeeklyReview>("/tasks/review");
  return data;
}

export async function getTask(id: string): Promise<TaskWithRelations> {
  const { data } = await client.get<TaskWithRelations>(`/tasks/${id}`);
  return data;
}

/** Löst einen öffentlichen Aufgaben-Link (Slug) in die Task auf – respektiert die Sichtbarkeitsregeln. */
export async function getTaskBySlug(slug: string): Promise<TaskWithRelations> {
  const { data } = await client.get<TaskWithRelations>(`/tasks/by-slug/${encodeURIComponent(slug)}`);
  return data;
}

/** Liefert den Share-Link-Slug einer Task (erzeugt ihn bei Bedarf). */
export async function ensureTaskShareLink(id: string): Promise<{ slug: string }> {
  const { data } = await client.post<{ slug: string }>(`/tasks/${id}/share-link`);
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

export interface CompleteResult {
  completed: boolean;
  nextDueAt: string | null;
  parentId: string | null;
  /** Automatisch nachgerückter Nächster Schritt des Projekts. */
  nextStep?: { id: string; title: string } | null;
}

export async function completeTask(id: string, nextDueAt?: string, comment?: string, force?: boolean, cascade?: boolean, occurrenceDate?: string, recurringCompletions?: Record<string, string>): Promise<CompleteResult> {
  const { data } = await client.post<CompleteResult>(`/tasks/${id}/complete`, { nextDueAt, comment, force, cascade, occurrenceDate, recurringCompletions });
  return data;
}

export async function reopenTask(id: string, occurrenceDate?: string): Promise<void> {
  await client.post(`/tasks/${id}/reopen`, occurrenceDate ? { occurrenceDate } : {});
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

export interface AiTaskSuggestion {
  description: string;
  context: string | null;
  duration: TaskDuration | null;
  energy: TaskEnergy | null;
  status: TaskStatus | null;
}

/** Fragt die KI nach Beschreibung und Einordnung. Der Schlüssel liegt auf dem Server. */
export async function generateTaskDescriptionAi(title: string, description?: string): Promise<AiTaskSuggestion> {
  const res = await client.post<AiTaskSuggestion>("/tasks/ai-describe", { title, description });
  return res.data;
}

export async function generateMindmapIdeasAi(topic: string): Promise<string[]> {
  const res = await client.post<{ ideas: string[] }>("/tasks/ai-mindmap", { topic });
  return res.data.ideas || [];
}