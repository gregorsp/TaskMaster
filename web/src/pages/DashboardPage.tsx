import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Typography, Stack, Button, Alert, useTheme, useMediaQuery, Badge,
} from "@mui/material";
import { Add as AddIcon, FilterList as FilterListIcon } from "@mui/icons-material";
import { listTasks } from "../api/tasksApi";
import { fetchPlanning } from "../api/planningApi";
import { listCategories, type Category } from "../api/categoriesApi";
import { listUsersPicker, type UserPickerItem } from "../api/usersApi";
import { TaskTree } from "../components/tasks/TaskTree";
import { TaskFilters } from "../components/tasks/TaskFilters";
import { useTaskFilters } from "../components/tasks/useTaskFilters";
import { applyTaskFilters, type TaskWithMeta } from "../components/tasks/taskFilterModel";
import { TaskForm } from "../components/tasks/TaskForm";
import { useNotify } from "../context/NotifyContext";
import { useModalStack } from "../components/tasks/ModalStackProvider";

export function DashboardPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const notify = useNotify();
  const { push, setOnRootUpdated } = useModalStack();

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<UserPickerItem[]>([]);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<number>>(new Set());

  const { filters, setFilter, reset, activeCount } = useTaskFilters({
    storageKey: "dashboard.filters",
    syncUrl: true,
  });

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTasks({ pageSize: "all" });
      setTasks(res.items as TaskWithMeta[]);
    } catch {
      notify("Fehler beim Laden der Aufgaben", "error");
    }
    setLoading(false);
  }, [notify]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { setOnRootUpdated(fetchTasks); }, [fetchTasks, setOnRootUpdated]);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
    listUsersPicker().then(setUsers).catch(() => {});
  }, []);

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

  const filteredTasks = useMemo(
    () => applyTaskFilters(tasks, filters),
    [tasks, filters]
  );

  const overdueCount = useMemo(
    () => tasks.filter((t) => t.isOverdue && !t.isCompleted).length,
    [tasks]
  );

  const openTask = useCallback(
    (task: TaskWithMeta) => push({ id: task.id, title: task.title }),
    [push]
  );

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Aufgaben {!loading && `(${filteredTasks.length})`}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTaskFormOpen(true)}>
          Neue Aufgabe
        </Button>
      </Stack>

      {isMobile && (
        <Button
          variant="outlined"
          startIcon={<FilterListIcon />}
          onClick={() => setFiltersOpen((o) => !o)}
          sx={{ mb: 2 }}
        >
          Suchen & Filtern
          {activeCount > 0 && <Badge badgeContent={activeCount} color="error" sx={{ ml: 1 }} />}
        </Button>
      )}

      {(!isMobile || filtersOpen) && (
        <Box sx={{ mb: 2 }}>
          <TaskFilters
            filters={filters}
            onChange={setFilter}
            onReset={reset}
            activeCount={activeCount}
            categories={categories}
            users={users}
            overdueCount={overdueCount}
          />
        </Box>
      )}

      <TaskTree
        tasks={filteredTasks}
        onTaskClick={openTask}
        onLinkClick={openTask}
        showPomodoros
        showLinkBadge
        sort={filters.sort}
        order={filters.order}
        completionMode={filters.completedDisplay}
        expandStorageKey="dashboard.expanded"
      />

      {loadWarnings.length > 0 && (
        <Stack spacing={0.5} mt={2}>
          {loadWarnings.map((w, i) => dismissedWarnings.has(i) ? null : (
            <Alert key={i} severity="warning" onClose={() => setDismissedWarnings((prev) => new Set(prev).add(i))}>
              {w}
            </Alert>
          ))}
        </Stack>
      )}

      {taskFormOpen && (
        <TaskForm
          open={taskFormOpen}
          onClose={() => setTaskFormOpen(false)}
          onCreated={() => { setTaskFormOpen(false); fetchTasks(); }}
        />
      )}
    </Box>
  );
}
