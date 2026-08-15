import type { Task } from "../../api/tasksApi";

export interface TaskWithMeta extends Task {
  _children?: TaskWithMeta[];
}

export type StatusFilter = "all" | "open" | "done";
export type HabitFilter = "all" | "habits" | "no_habits";
export type SortKey = "createdAt" | "dueAt" | "title";
export type SortOrder = "asc" | "desc";
export type CompletionMode = "hide_completed" | "show_all" | "hide_if_incomplete_parent";

export interface TaskFilterState {
  search: string;
  status: StatusFilter;
  categoryId: string;
  assigneeIds: string[];
  habit: HabitFilter;
  overdue: boolean;
  sort: SortKey;
  order: SortOrder;
  completedDisplay: CompletionMode;
}

export const DEFAULT_TASK_FILTERS: TaskFilterState = {
  search: "",
  status: "open",
  categoryId: "",
  assigneeIds: [],
  habit: "all",
  overdue: false,
  sort: "createdAt",
  order: "desc",
  completedDisplay: "hide_completed",
};

export function applyTaskFilters(tasks: TaskWithMeta[], f: TaskFilterState): TaskWithMeta[] {
  const q = f.search.trim().toLowerCase();

  let result = tasks.filter((t) => {
    if (f.status === "open" && t.isCompleted) return false;
    if (f.status === "done" && !t.isCompleted) return false;
    if (f.categoryId && !(t.categories ?? []).some((c) => c.id === f.categoryId)) return false;
    if (f.assigneeIds.length > 0 && !f.assigneeIds.every((id) => (t.assignees ?? []).some((a) => a.id === id))) return false;
    if (f.habit === "habits" && !t.isHabit) return false;
    if (f.habit === "no_habits" && t.isHabit) return false;
    if (f.overdue && !t.isOverdue) return false;
    if (q) {
      const title = (t.title ?? "").toLowerCase();
      const desc = (t.description ?? "").toLowerCase();
      if (!title.includes(q) && !desc.includes(q)) return false;
    }
    return true;
  });

  if (q) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const keep = new Set(result.map((t) => t.id));
    for (const t of [...result]) {
      let cur = t.parentId ? byId.get(t.parentId) : undefined;
      while (cur && !keep.has(cur.id)) {
        keep.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    result = tasks.filter((t) => keep.has(t.id));
  }

  return result;
}

function compare(a: TaskWithMeta, b: TaskWithMeta, sort: SortKey, order: SortOrder): number {
  let cmp = 0;
  if (sort === "title") {
    cmp = a.title.localeCompare(b.title, "de");
  } else if (sort === "dueAt") {
    const da = a.effectiveDueAt ? new Date(a.effectiveDueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const db = b.effectiveDueAt ? new Date(b.effectiveDueAt).getTime() : Number.MAX_SAFE_INTEGER;
    cmp = da - db;
  } else {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    cmp = da - db;
  }
  return order === "asc" ? cmp : -cmp;
}

export function buildTaskTree(tasks: TaskWithMeta[], sort: SortKey, order: SortOrder): TaskWithMeta[] {
  const map = new Map<string, TaskWithMeta>();
  for (const t of tasks) map.set(t.id, { ...t, _children: [] });

  const roots: TaskWithMeta[] = [];
  for (const t of map.values()) {
    const parent = t.parentId ? map.get(t.parentId) : undefined;
    if (parent) parent._children!.push(t);
    else roots.push(t);
  }

  const sortRec = (nodes: TaskWithMeta[]) => {
    nodes.sort((a, b) => compare(a, b, sort, order));
    for (const n of nodes) if (n._children?.length) sortRec(n._children);
  };
  sortRec(roots);

  return roots;
}

export function countActiveFilters(f: TaskFilterState, defaults: TaskFilterState = DEFAULT_TASK_FILTERS): number {
  let n = 0;
  if (f.search.trim() !== defaults.search.trim()) n++;
  if (f.status !== defaults.status) n++;
  if (f.categoryId !== defaults.categoryId) n++;
  if (f.assigneeIds.length !== defaults.assigneeIds.length) n++;
  if (f.habit !== defaults.habit) n++;
  if (f.overdue !== defaults.overdue) n++;
  if (f.sort !== defaults.sort) n++;
  if (f.order !== defaults.order) n++;
  if (f.completedDisplay !== defaults.completedDisplay) n++;
  return n;
}

export function collectDescendantIds(task: TaskWithMeta): string[] {
  const ids = [task.id];
  if (task._children) {
    for (const child of task._children) ids.push(...collectDescendantIds(child));
  }
  return ids;
}
