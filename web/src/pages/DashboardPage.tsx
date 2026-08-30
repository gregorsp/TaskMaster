import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography,
  Stack, Button, Pagination, Alert,
} from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { listTasks, type Task } from "../api/tasksApi";
import { fetchPlanning } from "../api/planningApi";
import { listCategories, type Category } from "../api/categoriesApi";
import { listUsersPicker, type UserPickerItem } from "../api/usersApi";
import { TaskListView } from "../components/tasks/TaskListView";
import { TaskForm } from "../components/tasks/TaskForm";
import { TaskFilterBar, createDefaultTaskFilterState, type TaskFilterState } from "../components/tasks/TaskFilterBar";
import { useNotify } from "../context/NotifyContext";

export function DashboardPage() {
  const [filters, setFilters] = useState<TaskFilterState>(createDefaultTaskFilterState);

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
  const notify = useNotify();

  const handleFilterChange = useCallback((next: TaskFilterState) => {
    setFilters(next);
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
      setTasks(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch {
      notify("Fehler beim Laden der Aufgaben", "error");
    }
  }, [page, filters, notify]);

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
