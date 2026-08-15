import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Typography, Stack, Paper, IconButton, Button, Chip, Checkbox,
  TextField, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, useTheme, useMediaQuery,
} from "@mui/material";
import {
  ChevronLeft, ChevronRight, Today as TodayIcon, Repeat as RepeatIcon,
} from "@mui/icons-material";
import { fetchDaily, type DailyData, type DailyHabit, type DailyTask } from "../api/dailyApi";
import { completeTask, reopenTask } from "../api/tasksApi";
import { listCategories, type Category } from "../api/categoriesApi";
import { TaskTree } from "../components/tasks/TaskTree";
import { TaskFilters } from "../components/tasks/TaskFilters";
import { useTaskFilters } from "../components/tasks/useTaskFilters";
import { applyTaskFilters, type TaskWithMeta } from "../components/tasks/taskFilterModel";
import { useModalStack } from "../components/tasks/ModalStackProvider";
import { useNotify } from "../context/NotifyContext";
import { useAuth } from "../context/AuthContext";

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

const weekdayLabel = (d: Date) =>
  d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function DailyPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const notify = useNotify();
  const { push, setOnRootUpdated } = useModalStack();
  const { user } = useAuth();

  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday);
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pendingHabit, setPendingHabit] = useState<DailyHabit | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { filters, setFilter, reset, activeCount } = useTaskFilters({
    storageKey: "daily.filters",
    defaults: { status: "open", sort: "dueAt", order: "asc", completedDisplay: "show_all" },
  });

  const isToday = toInputDate(selectedDate) === toInputDate(new Date());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchDaily(toInputDate(selectedDate));
      setData(res);
    } catch {
      notify("Fehler beim Laden der Tagesansicht", "error");
    }
    setLoading(false);
  }, [selectedDate, notify]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    setOnRootUpdated(fetchData);
    return () => setOnRootUpdated(() => {});
  }, [fetchData, setOnRootUpdated]);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
  }, []);

  const toggleHabit = async (habit: DailyHabit, confirmed = false) => {
    if (!habit.completedOnDate && !confirmed && user?.confirmHabitCompletion !== false) {
      setPendingHabit(habit);
      return;
    }
    setTogglingId(habit.id);
    try {
      const dateIso = toInputDate(selectedDate);
      if (habit.completedOnDate) {
        await reopenTask(habit.id, dateIso);
      } else {
        await completeTask(habit.id, undefined, undefined, undefined, undefined, dateIso);
      }
      await fetchData();
    } catch {
      notify("Fehler beim Erledigen", "error");
    }
    setTogglingId(null);
  };

  const confirmPendingHabit = async () => {
    if (!pendingHabit) return;
    setPendingHabit(null);
    await toggleHabit(pendingHabit, true);
  };

  const habits = data?.habits ?? [];
  const doneCount = habits.filter((h) => h.completedOnDate).length;

  const { tasksWithMeta, metaById } = useMemo(() => {
    const dailyTasks = data?.tasks ?? [];
    const seen = new Set<string>();
    const metas: TaskWithMeta[] = [];
    const byId = new Map<string, DailyTask>();
    for (const e of dailyTasks) {
      if (seen.has(e.task.id)) continue;
      seen.add(e.task.id);
      metas.push({ ...e.task, categories: e.categories, assignees: e.assignees });
      byId.set(e.task.id, e);
    }
    return { tasksWithMeta: metas, metaById: byId };
  }, [data]);

  const filteredTasks = useMemo(() => applyTaskFilters(tasksWithMeta, filters), [tasksWithMeta, filters]);

  const renderOccurrence = (task: TaskWithMeta) => {
    const meta = metaById.get(task.id);
    if (!meta) return null;
    return (
      <>
        {meta.type === "planned" && <Chip size="small" label="Geplant" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
        {meta.type === "due" && <Chip size="small" label="Fällig" variant="outlined" sx={{ fontSize: 10, height: 18 }} />}
        {meta.occurrenceDate && (
          <Chip
            size="small"
            icon={<RepeatIcon sx={{ fontSize: 12 }} />}
            label={`Wdh. ${new Date(meta.occurrenceDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`}
            variant="outlined"
            sx={{ fontSize: 10, height: 18 }}
          />
        )}
      </>
    );
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
          <IconButton onClick={() => setSelectedDate((d) => addDays(d, -1))}><ChevronLeft /></IconButton>
          <TextField
            type="date"
            size="small"
            value={toInputDate(selectedDate)}
            onChange={(e) => {
              const v = e.target.value;
              if (v) {
                const [y, m, d] = v.split("-").map(Number);
                setSelectedDate(new Date(y, m - 1, d));
              }
            }}
            sx={{ width: 190 }}
          />
          <IconButton onClick={() => setSelectedDate((d) => addDays(d, 1))}><ChevronRight /></IconButton>
          {!isToday && (
            <Button size="small" startIcon={<TodayIcon />} onClick={() => setSelectedDate(startOfToday())}>
              Heute
            </Button>
          )}
        </Stack>
        <Typography variant="h5" fontWeight={600} sx={{ textTransform: "capitalize" }}>
          {isToday ? "Heute" : weekdayLabel(selectedDate)}
        </Typography>
      </Stack>

      {loading && <CircularProgress size={24} />}

      {!loading && data && (
        <Stack direction={isMobile ? "column" : "row"} spacing={2} alignItems="flex-start">
          <Paper variant="outlined" sx={{ p: 2, flex: isMobile ? undefined : "0 0 380px", width: isMobile ? "100%" : undefined }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
              <Typography variant="h6">Habits</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
                {doneCount}/{habits.length}
              </Typography>
            </Stack>
            {habits.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                Keine Habits vorhanden. Lege ein Habit über "Neue Aufgabe" an.
              </Typography>
            )}
            <Stack spacing={0.5}>
              {habits.map((habit) => (
                <Paper
                  key={habit.id}
                  variant="outlined"
                  sx={{
                    p: 0.75,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    opacity: habit.completedOnDate ? 0.55 : 1,
                    borderLeft: habit.categories[0]?.color ? `4px solid ${habit.categories[0].color}` : undefined,
                  }}
                >
                  <Checkbox
                    size="small"
                    checked={habit.completedOnDate}
                    disabled={togglingId === habit.id}
                    onChange={() => toggleHabit(habit)}
                    inputProps={{ "aria-label": `Habit ${habit.title} erledigen` }}
                  />
                  <Typography
                    variant="body2"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      overflowWrap: "anywhere",
                      textDecoration: habit.completedOnDate ? "line-through" : undefined,
                    }}
                  >
                    {habit.title}
                  </Typography>
                  {habit.isImportant && <Chip size="small" label="Wichtig" color="warning" variant="outlined" />}
                  {habit.pomodoros != null && (
                    <Chip size="small" label={`${habit.pomodoros} Pomo`} color="secondary" variant="outlined" />
                  )}
                  <Button size="small" sx={{ minWidth: 0, p: 0.5 }} onClick={() => push({ id: habit.id, title: habit.title })}>
                    Details
                  </Button>
                </Paper>
              ))}
            </Stack>
          </Paper>

          <Box sx={{ flex: 1, minWidth: 0, width: "100%" }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1} flexWrap="wrap" gap={1}>
              <Typography variant="h6">Tagesaufgaben</Typography>
            </Stack>

            <Box sx={{ mb: 2 }}>
              <TaskFilters
                filters={filters}
                onChange={setFilter}
                onReset={reset}
                activeCount={activeCount}
                categories={categories}
                show={{ assignee: false, habit: false, overdue: false, completedDisplay: false }}
              />
            </Box>

            <TaskTree
              tasks={filteredTasks}
              onTaskClick={(task) => push({ id: task.id, title: task.title })}
              showPomodoros
              sort={filters.sort}
              order={filters.order}
              completionMode={filters.completedDisplay}
              expandStorageKey="daily.expanded"
              renderExtra={renderOccurrence}
            />
          </Box>
        </Stack>
      )}

      <Dialog open={!!pendingHabit} onClose={() => setPendingHabit(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Habit erledigen?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            "{pendingHabit?.title}" für {weekdayLabel(selectedDate)} als erledigt markieren?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingHabit(null)}>Abbrechen</Button>
          <Button variant="contained" color="success" onClick={confirmPendingHabit}>Erledigen</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
