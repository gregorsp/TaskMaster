import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Box, Typography,
  Stack, Button, Pagination, Alert,
} from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { listTasks, getSubtasks, type Task } from "../api/tasksApi";
import { fetchPlanning } from "../api/planningApi";
import { listCategories, type Category } from "../api/categoriesApi";
import { listContexts, type TaskContext } from "../api/contextsApi";
import { listUsersPicker, type UserPickerItem } from "../api/usersApi";
import { TaskListView } from "../components/tasks/TaskListView";
import { TaskForm } from "../components/tasks/TaskForm";
import { TaskFilterBar, createDefaultTaskFilterState, type TaskFilterState } from "../components/tasks/TaskFilterBar";
import { useNotify } from "../context/NotifyContext";

type DashboardTab = "" | "next" | "waiting" | "someday" | "project" | "inbox";

const TABS: { key: DashboardTab; label: string }[] = [
  { key: "", label: "Alle Aufgaben" },
  { key: "next", label: "Nächster Schritt" },
  { key: "waiting", label: "Warten auf" },
  { key: "someday", label: "Irgendwann" },
  { key: "project", label: "Projekte" },
  { key: "inbox", label: "Eingangskorb" },
];

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<TaskFilterState>(() => ({
    ...createDefaultTaskFilterState(),
    categoryId: searchParams.get("categoryId") || "",
    contextId: searchParams.get("contextId") || "",
  }));

  useEffect(() => {
    const urlCat = searchParams.get("categoryId") || "";
    const urlCtx = searchParams.get("contextId") || "";
    setFilters((prev) =>
      prev.categoryId === urlCat && prev.contextId === urlCtx ? prev : { ...prev, categoryId: urlCat, contextId: urlCtx }
    );
  }, [searchParams]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contexts, setContexts] = useState<TaskContext[]>([]);
  const [users, setUsers] = useState<UserPickerItem[]>([]);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState<DashboardTab>("");
  const [reviewReport, setReviewReport] = useState<{ inboxCount: number; stalledProjects: string[] } | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const runWeeklyReview = async () => {
    setReviewLoading(true);
    try {
      const fetchAllPages = async (params: Record<string, unknown>): Promise<Task[]> => {
        const all: Task[] = [];
        for (let pNum = 1; ; pNum++) {
          const res = await listTasks({ ...params, page: pNum, pageSize: 100 });
          all.push(...res.items);
          if (pNum >= res.totalPages || res.items.length === 0) break;
        }
        return all;
      };
      const inboxItems = await fetchAllPages({ isCompleted: false, uncategorized: true });
      const projects = await fetchAllPages({ isCompleted: false, isProject: true });
      const stalledProjects: string[] = [];
      for (const proj of projects) {
        const subs = await getSubtasks(proj.id);
        const subItems = Array.isArray(subs) ? subs : (subs.subtasks || []);
        if (!subItems.some((s) => !s.isCompleted)) stalledProjects.push(proj.title);
      }
      setReviewReport({ inboxCount: inboxItems.length, stalledProjects });
    } finally { setReviewLoading(false); }
  };
  const notify = useNotify();

  const handleFilterChange = useCallback((next: TaskFilterState) => {
    setFilters(next);
    const params: Record<string, string> = {};
    if (next.categoryId) params.categoryId = next.categoryId;
    if (next.contextId) params.contextId = next.contextId;
    if (Object.keys(params).length > 0) {
      setSearchParams(params, { replace: true });
    } else if (searchParams.has("categoryId") || searchParams.has("contextId")) {
      setSearchParams({}, { replace: true });
    }
    setPage(1);
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const tabStatus = tab === "next" || tab === "waiting" || tab === "someday" ? tab : undefined;
      const res = await listTasks({
        page, pageSize: 20,
        search: filters.search ? filters.search.trim() : undefined,
        isCompleted: filters.status === "all" ? undefined : filters.status === "done",
        categoryId: filters.categoryId || undefined,
        contextId: filters.contextId || undefined,
        status: tabStatus ?? (filters.gtdStatus || undefined),
        duration: filters.duration || undefined,
        energy: filters.energy || undefined,
        isProject: tab === "project" ? true : undefined,
        uncategorized: tab === "inbox" ? true : undefined,
        isOverdue: filters.isOverdue || undefined,
        isHabit: filters.habitFilter === "all" ? undefined : filters.habitFilter === "habits",
        assigneeIds: filters.assigneeIds.length > 0 ? filters.assigneeIds : undefined,
        hidePlanned: filters.hidePlanned || undefined,
        sort: filters.sort, order: filters.sortOrder,
      });
      setTasks(res.items); setTotal(res.total); setTotalPages(res.totalPages);
    } catch { notify("Fehler beim Laden der Aufgaben", "error"); }
  }, [page, filters, tab, notify]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
    listContexts().then(setContexts).catch(() => {});
  }, []);

  useEffect(() => {
    listUsersPicker().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    listTasks({
      isOverdue: true,
      pageSize: 1,
      search: filters.search ? filters.search.trim() : undefined,
      categoryId: filters.categoryId || undefined,
      assigneeIds: filters.assigneeIds.length > 0 ? filters.assigneeIds : undefined,
      hidePlanned: filters.hidePlanned || undefined,
    })
      .then((res) => { if (!cancelled) setOverdueCount(res.total); })
      .catch(() => { if (!cancelled) setOverdueCount(0); });
    return () => { cancelled = true; };
  }, [filters]);

  useEffect(() => {
    const toDateOnly = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = new Date();
    const from = toDateOnly(today);
    const to = toDateOnly(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6));
    fetchPlanning(from, to)
      .then((data) => {
        const warnings: string[] = [];
        const todayDay = data.days[0];
        if (todayDay?.overloaded) {
          warnings.push(`Heute: ${todayDay.usedSp}/${todayDay.capacity} Pomodori geplant – ${todayDay.usedSp - todayDay.capacity} über Budget`);
        }
        for (const hw of data.horizonWarnings) {
          const d = new Date(`${hw.deadlineDate}T00:00:00`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
          warnings.push(`Bis ${d}: ${hw.requiredSp} Pomodori fällig, nur ${hw.availableSp} Kapazität (–${hw.shortfall})`);
        }
        setLoadWarnings(warnings);
      })
      .catch(() => setLoadWarnings([]));
  }, []);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Aufgaben {total > 0 && `(${total})`}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTaskFormOpen(true)}>
          Neue Aufgabe
        </Button>
      </Stack>

      <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" useFlexGap alignItems="center">
        {TABS.map((entry) => (
          <Button
            key={entry.key || "all"}
            size="small"
            variant={tab === entry.key ? "contained" : "outlined"}
            color={entry.key === "inbox" ? "warning" : "primary"}
            onClick={() => { setTab(entry.key); setPage(1); }}
          >
            {entry.label}
          </Button>
        ))}
        <Button size="small" variant="outlined" color="secondary" onClick={runWeeklyReview} disabled={reviewLoading} sx={{ ml: "auto" }}>
          {reviewLoading ? "Prüft..." : "Weekly Review"}
        </Button>
      </Stack>

      {reviewReport && (
        <Alert severity={reviewReport.stalledProjects.length === 0 && reviewReport.inboxCount === 0 ? "success" : "info"} onClose={() => setReviewReport(null)} sx={{ mb: 2 }}>
          <strong>GTD Weekly Review:</strong> {reviewReport.inboxCount} ungeklärte Aufgabe(n) im Eingangskorb.{" "}
          {reviewReport.stalledProjects.length === 0
            ? "Alle Projekte haben mindestens einen offenen Nächsten Schritt!"
            : `Projekte ohne Nächsten Schritt: ${reviewReport.stalledProjects.join(", ")}`}
        </Alert>
      )}

      <TaskFilterBar
        value={filters}
        onChange={handleFilterChange}
        categories={categories}
        contexts={contexts}
        users={users}
        overdueCount={overdueCount}
      />

      <TaskListView tasks={tasks} onUpdated={fetchTasks} />

      {loadWarnings.length > 0 && (
        <Stack spacing={0.5} mt={2}>
          {loadWarnings.map((w, i) => dismissedWarnings.has(i) ? null : (
            <Alert key={i} severity="warning" onClose={() => setDismissedWarnings((prev) => new Set(prev).add(i))}>
              {w}
            </Alert>
          ))}
        </Stack>
      )}

      {totalPages > 1 && (
        <Stack direction="row" justifyContent="center" mt={2}>
          <Pagination count={totalPages} page={page} onChange={(_, p) => setPage(p)} />
        </Stack>
      )}

      {taskFormOpen && <TaskForm open={taskFormOpen} onClose={() => setTaskFormOpen(false)} onCreated={() => { setTaskFormOpen(false); fetchTasks(); }} />}
    </Box>
  );
}
