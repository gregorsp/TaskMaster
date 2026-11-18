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
import { listUsersPicker, type UserPickerItem } from "../api/usersApi";
import { TaskListView } from "../components/tasks/TaskListView";
import { TaskForm } from "../components/tasks/TaskForm";
import { TaskFilterBar, createDefaultTaskFilterState, type TaskFilterState } from "../components/tasks/TaskFilterBar";
import { useNotify } from "../context/NotifyContext";

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<TaskFilterState>(() => ({
    ...createDefaultTaskFilterState(),
    categoryId: searchParams.get("categoryId") || "",
  }));

  useEffect(() => {
    const urlCat = searchParams.get("categoryId") || "";
    setFilters((prev) => (prev.categoryId === urlCat ? prev : { ...prev, categoryId: urlCat }));
  }, [searchParams]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<UserPickerItem[]>([]);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<number>>(new Set());
  const [inboxOnly, setInboxOnly] = useState(false);
  const [reviewReport, setReviewReport] = useState<{ inboxCount: number; stalledProjects: string[] } | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  const runWeeklyReview = async () => {
    setReviewLoading(true);
    try {
      const openAll = await listTasks({ isCompleted: false, pageSize: 200 });
      type TaskWithCats = Task & { categories?: { id: string }[] }; const allItems = openAll.items as TaskWithCats[]; const inboxCount = allItems.filter((t) => !t.categories || t.categories.length === 0).length;
      const projCat = categories.find((c) => c.name.toLowerCase().includes("projekt"));
      const stalledProjects: string[] = [];
      if (projCat) {
        const projects = allItems.filter((t) => t.categories?.some((c) => c.id === projCat.id));
        for (const p of projects) {
          const subs = await getSubtasks(p.id);
          const subItems = Array.isArray(subs) ? subs : (subs as { items?: Task[] }).items || []; const hasOpenNext = subItems.some((s) => !s.isCompleted);
          if (!hasOpenNext) stalledProjects.push(p.title);
        }
      }
      setReviewReport({ inboxCount, stalledProjects });
    } finally {
      setReviewLoading(false);
    }
  };
  const notify = useNotify();

  const handleFilterChange = useCallback((next: TaskFilterState) => {
    setFilters(next);
    if (next.categoryId) {
      setSearchParams({ categoryId: next.categoryId }, { replace: true });
    } else if (searchParams.has("categoryId")) {
      setSearchParams({}, { replace: true });
    }
    setPage(1);
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await listTasks({
        page,
        pageSize: 20,
        search: filters.search || undefined,
        isCompleted: filters.status === "all" ? undefined : filters.status === "done",
        categoryId: filters.categoryId || undefined,
        isOverdue: filters.isOverdue || undefined,
        isHabit: filters.habitFilter === "all" ? undefined : filters.habitFilter === "habits",
        assigneeIds: filters.assigneeIds.length > 0 ? filters.assigneeIds : undefined,
        hidePlanned: filters.hidePlanned || undefined,
        sort: filters.sort,
        order: filters.sortOrder,
      });
      type TaskWithCats = Task & { categories?: { id: string }[] }; setTasks(inboxOnly ? (res.items as TaskWithCats[]).filter((t) => !t.categories || t.categories.length === 0) : res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch {
      notify("Fehler beim Laden der Aufgaben", "error");
    }
  }, [page, filters, inboxOnly, notify]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    listUsersPicker().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    listTasks({
      isOverdue: true,
      pageSize: 1,
      search: filters.search || undefined,
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
        <Button
          size="small"
          variant={inboxOnly ? "contained" : "outlined"}
          color="warning"
          onClick={() => {
            const next = !inboxOnly;
            setInboxOnly(next);
            if (next) handleFilterChange({ ...filters, categoryId: "" });
          }}
        >
          Eingangskorb
        </Button>
        {[
          { label: "Alle Aufgaben", id: "" },
          { label: "Projekte", key: "projekt" },
          { label: "Nächste Schritte", key: "nächste" },
          { label: "Warten auf", key: "warten" },
          { label: "Irgendwann/Vielleicht", key: "irgendwann" },
        ].map((tab) => {
          const matchedCat = tab.key
            ? categories.find((c) => c.name.toLowerCase().includes(tab.key!))
            : undefined;
          const targetId = tab.key ? matchedCat?.id : "";
          if (tab.key && !matchedCat) return null;
          const isActive = !inboxOnly && filters.categoryId === (targetId || "");
          return (
            <Button
              key={tab.label}
              size="small"
              variant={isActive ? "contained" : "outlined"}
              onClick={() => { setInboxOnly(false); handleFilterChange({ ...filters, categoryId: targetId || "" }); }}
            >
              {tab.label}
            </Button>
          );
        })}
        <Button size="small" variant="outlined" color="secondary" onClick={runWeeklyReview} disabled={reviewLoading} sx={{ ml: "auto" }}>
          {reviewLoading ? "Prüft..." : "Weekly Review"}
        </Button>
      </Stack>

      {reviewReport && (
        <Alert severity={reviewReport.stalledProjects.length === 0 && reviewReport.inboxCount === 0 ? "success" : "info"} onClose={() => setReviewReport(null)} sx={{ mb: 2 }}>
          <strong>GTD Weekly Review:</strong> {reviewReport.inboxCount} ungeklärte Aufgabe(n) im Eingangskorb.{" "}
          {reviewReport.stalledProjects.length === 0
            ? "Alle aktiven Projekte haben mindestens einen offenen Nächsten Schritt!"
            : `Projekte ohne Nächsten Schritt: ${reviewReport.stalledProjects.join(", ")}`}
        </Alert>
      )}

      <TaskFilterBar
        value={filters}
        onChange={handleFilterChange}
        categories={categories}
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
