import { useCallback, useMemo, useState } from "react";
import { DEFAULT_TASK_FILTERS, countActiveFilters, type TaskFilterState } from "./taskFilterModel";

interface UseTaskFiltersOptions {
  storageKey: string;
  syncUrl?: boolean;
  defaults?: Partial<TaskFilterState>;
}

const STRING_KEYS = ["search", "status", "categoryId", "habit", "sort", "order", "completedDisplay"] as const;
const BOOL_KEYS = ["overdue"] as const;

function serializeToUrl(f: TaskFilterState): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.search) out.search = f.search;
  if (f.status !== "all") out.status = f.status;
  if (f.categoryId) out.categoryId = f.categoryId;
  if (f.assigneeIds.length) out.assigneeIds = f.assigneeIds.join(",");
  if (f.habit !== "all") out.habit = f.habit;
  if (f.overdue) out.overdue = "1";
  if (f.sort !== "createdAt") out.sort = f.sort;
  if (f.order !== "desc") out.order = f.order;
  if (f.completedDisplay !== "hide_completed") out.completedDisplay = f.completedDisplay;
  return out;
}

function parseUrl(search: string): Partial<TaskFilterState> {
  const params = new URLSearchParams(search.split("?")[1] || "");
  const out: Partial<TaskFilterState> = {};
  for (const key of STRING_KEYS) {
    const v = params.get(`f_${key}`);
    if (v !== null) (out as Record<string, unknown>)[key] = v;
  }
  if (params.get("f_assigneeIds") !== null) {
    out.assigneeIds = (params.get("f_assigneeIds") || "").split(",").filter(Boolean);
  }
  for (const key of BOOL_KEYS) {
    const v = params.get(`f_${key}`);
    if (v !== null) (out as Record<string, unknown>)[key] = v === "1" || v === "true";
  }
  return out;
}

function writeUrl(f: TaskFilterState) {
  const params = new URLSearchParams(window.location.search);
  for (const key of [...params.keys()]) if (key.startsWith("f_")) params.delete(key);
  for (const [k, v] of Object.entries(serializeToUrl(f))) params.set(`f_${k}`, v);
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", url);
}

function readStorage(key: string): Partial<TaskFilterState> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<TaskFilterState>) : {};
  } catch {
    return {};
  }
}

export function useTaskFilters({ storageKey, syncUrl, defaults }: UseTaskFiltersOptions) {
  const defaultsKey = defaults ? JSON.stringify(defaults) : "";

  const baseDefaults = useMemo<TaskFilterState>(
    () => ({ ...DEFAULT_TASK_FILTERS, ...(defaults ?? {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultsKey]
  );

  const [filters, setFilters] = useState<TaskFilterState>(() => {
    let stored: Partial<TaskFilterState> = readStorage(storageKey);
    if (syncUrl) stored = { ...stored, ...parseUrl(window.location.search) };
    return { ...baseDefaults, ...stored };
  });

  const setFilter = useCallback(
    (patch: Partial<TaskFilterState>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        if (syncUrl) writeUrl(next);
        return next;
      });
    },
    [storageKey, syncUrl]
  );

  const reset = useCallback(() => {
    setFilters(baseDefaults);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    if (syncUrl) {
      const params = new URLSearchParams(window.location.search);
      for (const key of [...params.keys()]) if (key.startsWith("f_")) params.delete(key);
      const qs = params.toString();
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
      window.history.replaceState(null, "", url);
    }
  }, [storageKey, syncUrl, baseDefaults]);

  const activeCount = useMemo(() => countActiveFilters(filters, baseDefaults), [filters, baseDefaults]);

  return { filters, setFilter, reset, activeCount };
}
