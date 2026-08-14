import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Stack, Paper, IconButton, Button, Chip, Checkbox,
  TextField, Select, MenuItem, FormControl, InputLabel, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, useTheme, useMediaQuery,
} from "@mui/material";
import {
  ChevronLeft, ChevronRight, Today as TodayIcon, Repeat as RepeatIcon,
} from "@mui/icons-material";
import { fetchDaily, type DailyData, type DailyHabit, type DailyTask } from "../api/dailyApi";
import { completeTask, reopenTask } from "../api/tasksApi";
import { listCategories, type Category } from "../api/categoriesApi";
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
  const [taskFilter, setTaskFilter] = useState<"all" | "open" | "done">("open");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState<"dueAt" | "title">("dueAt");
  const [pendingHabit, setPendingHabit] = useState<DailyHabit | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

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

  const allTasks = data?.tasks ?? [];
  const filteredTasks = allTasks.filter((t) => {
    if (categoryFilter && !t.categories.some((c) => c.id === categoryFilter)) return false;
    if (taskFilter === "open" && t.task.isCompleted) return false;
    if (taskFilter === "done" && !t.task.isCompleted) return false;
    return true;
  });
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === "title") return a.task.title.localeCompare(b.task.title, "de");
    const aDue = a.task.effectiveDueAt ? new Date(a.task.effectiveDueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.task.effectiveDueAt ? new Date(b.task.effectiveDueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  });

  const renderTask = (entry: DailyTask) => {
    const { task } = entry;
    const overdue = task.isOverdue && !task.isCompleted;
    const categoryColor = entry.categories[0]?.color;
    return (
      <Paper
        key={`${task.id}-${entry.occurrenceId ?? "base"}`}
        variant="outlined"
        onClick={() => push({ id: task.id, title: task.title })}
        sx={{
          p: 1.5,
          cursor: "pointer",
          opacity: task.isCompleted ? 0.55 : 1,
          borderLeft: categoryColor ? `4px solid ${categoryColor}` : undefined,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography
            variant="body2"
            sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", textDecoration: task.isCompleted ? "line-through" : undefined }}
          >
            {task.title}
          </Typography>
          {task.isHabit && <Chip size="small" label="Habit" color="success" variant="outlined" />}
          {overdue && <Chip size="small" label="überfällig" color="error" />}
          {task.isImportant && <Chip size="small" label="Wichtig" color="warning" variant="outlined" />}
          {task.pomodoros != null && (
            <Chip size="small" label={`${task.pomodoros} Pomo`} color="secondary" variant="outlined" />
          )}
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
          {entry.type === "planned" && (
            <Chip size="small" label="Geplant" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
          )}
          {entry.type === "due" && (
            <Chip size="small" label="Fällig" variant="outlined" sx={{ fontSize: 10, height: 18 }} />
          )}
          {entry.occurrenceDate && (
            <Chip
              size="small"
              icon={<RepeatIcon sx={{ fontSize: 12 }} />}
              label={`Wdh. ${new Date(entry.occurrenceDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`}
              variant="outlined"
              sx={{ fontSize: 10, height: 18 }}
            />
          )}
          {task.dueAt && (
            <Typography variant="caption" color="text.secondary">
              Fällig: {new Date(task.dueAt).toLocaleDateString("de-DE")}
            </Typography>
          )}
          {entry.assignees.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {entry.assignees.map((a) => a.displayName).join(", ")}
            </Typography>
          )}
        </Stack>
      </Paper>
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
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <FormControl size="small" sx={{ minWidth: 110 }}>
                  <InputLabel>Status</InputLabel>
                  <Select value={taskFilter} label="Status" onChange={(e) => setTaskFilter(e.target.value as typeof taskFilter)}>
                    <MenuItem value="open">Offen</MenuItem>
                    <MenuItem value="done">Erledigt</MenuItem>
                    <MenuItem value="all">Alle</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel>Kategorie</InputLabel>
                  <Select value={categoryFilter} label="Kategorie" onChange={(e) => setCategoryFilter(e.target.value)}>
                    <MenuItem value="">Alle</MenuItem>
                    {categories.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: c.color }} />
                          {c.name}
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel>Sortierung</InputLabel>
                  <Select value={sortBy} label="Sortierung" onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                    <MenuItem value="dueAt">Fälligkeit</MenuItem>
                    <MenuItem value="title">Titel</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            </Stack>

            <Stack spacing={1}>
              {sortedTasks.map(renderTask)}
              {sortedTasks.length === 0 && (
                <Paper variant="outlined" sx={{ p: 3 }}>
                  <Typography color="text.secondary" textAlign="center">
                    Keine Aufgaben für diesen Tag {categoryFilter ? "(Filter aktiv)" : ""}.
                  </Typography>
                </Paper>
              )}
            </Stack>
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
