import { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Typography, Stack, Paper, IconButton, Button, Alert,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  Chip,
} from "@mui/material";
import { ChevronLeft, ChevronRight } from "@mui/icons-material";
import { fetchPlanning, saveDraft, discardDraft, confirmPlanning, type LoadDay, type PlanningDraft, type PlanningData } from "../api/planningApi";
import type { Task } from "../api/tasksApi";
import { createTaskOccurrence, deleteTaskOccurrence } from "../api/tasksApi";
import { listCategories, type Category } from "../api/categoriesApi";
import { listUsersPicker, type UserPickerItem } from "../api/usersApi";
import { TaskTree } from "../components/tasks/TaskTree";
import type { TaskWithMeta } from "../components/tasks/TaskTree";
import { collectDescendantIds } from "../components/tasks/TaskTree";
import { OccurrencePicker } from "../components/tasks/OccurrencePicker";
import { useModalStack } from "../components/tasks/ModalStackProvider";
import { useNotify } from "../context/NotifyContext";
import { useAuth } from "../context/AuthContext";

const WEEKDAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WEEKDAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function mondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateRange(start: Date, end: Date): string {
  return `${start.toLocaleDateString("de-DE", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" })}`;
}

function isoDateOnly(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

function formatPlannedDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gestern";
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export function PlanningPage() {
  const { user } = useAuth();
  const notify = useNotify();
  const { push } = useModalStack();
  const isAdmin = user?.isAdmin ?? false;

  const [currentMonday, setCurrentMonday] = useState(() => mondayOfWeek(new Date()));
  const [data, setData] = useState<PlanningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<PlanningDraft | null>(null);
  const [hasUnconfirmed, setHasUnconfirmed] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<UserPickerItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [userIdFilter, setUserIdFilter] = useState("");
  const [occurrenceDialogOpen, setOccurrenceDialogOpen] = useState(false);
  const [occurrenceTask, setOccurrenceTask] = useState<TaskWithMeta | null>(null);
  const [occurrenceTargetDate, setOccurrenceTargetDate] = useState("");
  const [occurrenceDate, setOccurrenceDate] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekEnd = new Date(currentMonday);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const todayStr = isoDateOnly(new Date());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const from = currentMonday.toISOString();
      const to = weekEnd.toISOString();
      const result = await fetchPlanning(from, to, userIdFilter || undefined);
      setData(result);
      setDraft(result.draft);
      setHasUnconfirmed(false);
    } catch {
      setError("Fehler beim Laden der Planungsdaten.");
    }
    setLoading(false);
  }, [currentMonday.getTime(), userIdFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
    listUsersPicker().then(setUsers).catch(() => {});
  }, []);

  const autosaveDraft = useCallback(
    (changes: Record<string, string | null>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const result = await saveDraft(changes);
          setDraft(result);
          setHasUnconfirmed(Object.keys(changes).length > 0);
        } catch {
          // silently fail on autosave
        }
      }, 500);
    },
    []
  );

  const dropOnDay = useCallback(
    (taskIds: string[], targetDate: string) => {
      const allTasks = (data?.tasks ?? []) as TaskWithMeta[];
      const recurringTasks = allTasks.filter((t) => taskIds.includes(t.id) && t.recurrenceType === "rrule");
      if (recurringTasks.length > 0) {
        setOccurrenceTask(recurringTasks[0]);
        setOccurrenceTargetDate(targetDate);
        setOccurrenceDate("");
        setOccurrenceDialogOpen(true);
        return;
      }

      const currentChanges = { ...draft?.changes ?? {} };
      for (const taskId of taskIds) {
        currentChanges[taskId] = targetDate;
      }
      setDraft((prev) => ({ changes: currentChanges, lastModified: new Date().toISOString() }));
      setHasUnconfirmed(true);
      autosaveDraft(currentChanges);
    },
    [draft, autosaveDraft, data]
  );

  const handleOccurrencePlan = async () => {
    if (!occurrenceTask || !occurrenceTargetDate || !occurrenceDate) return;
    try {
      await createTaskOccurrence(occurrenceTask.id, occurrenceDate, occurrenceTargetDate);
      notify("Wiederkehrende Aufgabe geplant");
      setOccurrenceDialogOpen(false);
      await fetchData();
    } catch {
      notify("Fehler beim Planen", "error");
    }
  };

  const handleRemoveOccurrence = async (occurrenceId: string, taskId: string) => {
    try {
      await deleteTaskOccurrence(taskId, occurrenceId);
      notify("Planung entfernt");
      await fetchData();
    } catch {
      notify("Fehler beim Entfernen", "error");
    }
  };

  const removeFromDay = useCallback(
    (taskId: string) => {
      const currentChanges = { ...draft?.changes ?? {} };
      currentChanges[taskId] = null;
      setDraft((prev) => ({ changes: currentChanges, lastModified: new Date().toISOString() }));
      setHasUnconfirmed(true);
      autosaveDraft(currentChanges);
    },
    [draft, autosaveDraft]
  );

  const handleConfirm = async () => {
    setConfirmDialogOpen(true);
  };

  const handleConfirmExecute = async () => {
    setConfirmDialogOpen(false);
    setSaving(true);
    try {
      const result = await confirmPlanning();
      notify(`Planung gespeichert (${result.updated} Aufgaben aktualisiert)`);
      setHasUnconfirmed(false);
      await fetchData();
    } catch {
      notify("Fehler beim Speichern der Planung", "error");
    }
    setSaving(false);
  };

  const handleDiscard = async () => {
    try {
      await discardDraft();
      setDraft(null);
      setHasUnconfirmed(false);
      notify("Planung verworfen");
      await fetchData();
    } catch {
      notify("Fehler beim Verwerfen", "error");
    }
  };

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnconfirmed) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnconfirmed]);

  const prevWeek = () => {
    const d = new Date(currentMonday);
    d.setDate(d.getDate() - 7);
    setCurrentMonday(d);
  };

  const nextWeek = () => {
    const d = new Date(currentMonday);
    d.setDate(d.getDate() + 7);
    setCurrentMonday(d);
  };

  const tasksWithMeta: TaskWithMeta[] = (data?.tasks ?? []).map((t) => ({ ...t })) as TaskWithMeta[];

  const days = data?.days ?? [];
  const horizonWarnings = data?.horizonWarnings ?? [];

  const getEffectivePlannedDate = (taskId: string): string | null => {
    if (draft?.changes?.[taskId] !== undefined) {
      return draft.changes[taskId];
    }
    const task = tasksWithMeta.find((t) => t.id === taskId);
    return task?.plannedDate ?? null;
  };

  interface DayTaskEntry {
    task: TaskWithMeta;
    plannedDate: string | null;
    type: "due" | "planned";
    occurrenceId: string | null;
    occurrenceDate: string | null;
  }

  const getDayTasks = (dayDate: string): DayTaskEntry[] => {
    const entries: DayTaskEntry[] = [];
    const day = days.find((d) => d.date === dayDate);

    for (const task of tasksWithMeta) {
      if (task.isCompleted) continue;

      const effectivePlanned = getEffectivePlannedDate(task.id);
      const effectiveDue = task.effectiveDueAt;

      if (effectivePlanned && isoDateOnly(new Date(effectivePlanned)) === dayDate) {
        entries.push({ task, plannedDate: effectivePlanned, type: "planned", occurrenceId: null, occurrenceDate: null });
      } else if (effectiveDue && isoDateOnly(new Date(effectiveDue)) === dayDate && !effectivePlanned) {
        entries.push({ task, plannedDate: null, type: "due", occurrenceId: null, occurrenceDate: null });
      }
    }

    if (day) {
      for (const t of day.tasks) {
        if (t.occurrenceId && t.occurrenceDate) {
          const task = tasksWithMeta.find((twm) => twm.id === t.id);
          if (task && !task.isCompleted) {
            entries.push({
              task,
              plannedDate: t.occurrenceDate,
              type: "planned",
              occurrenceId: t.occurrenceId,
              occurrenceDate: t.occurrenceDate,
            });
          }
        }
      }
    }

    const entryIds = new Set(entries.map((e) => e.task.id));
    return entries.filter((e) => {
      const parentId = e.task.parentId;
      if (!parentId) return true;
      return !entryIds.has(parentId);
    });
  };

  function renderDayTask(entry: DayTaskEntry, level: number, dayDate: string) {
    const { task, plannedDate, type, occurrenceId, occurrenceDate } = entry;
    const isPlanned = type === "planned";
    const isOverdue = task.isOverdue;
    const isCompleted = task.isCompleted;
    const categoryColor = (task as any).categories?.[0]?.color;
    const childEntries = getChildEntries(task.id, dayDate);

    return (
      <Box key={task.id}>
        <Paper
          draggable
          onDragStart={(e) => {
            const ids = collectDescendantIds(task);
            e.dataTransfer.setData("text/task-ids", JSON.stringify(ids));
            e.dataTransfer.setData("text/task-id", task.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => push({ id: task.id, title: task.title })}
          sx={{
            p: 0.75, cursor: "pointer", fontSize: 12,
            ml: level > 0 ? `${level * 14}px` : 0,
            textDecoration: isCompleted ? "line-through" : undefined,
            border: isPlanned ? `1.5px dashed ${categoryColor || "divider"}` : undefined,
            bgcolor: isCompleted ? "action.disabledBackground"
              : isOverdue ? "error.light"
              : isPlanned ? "transparent"
              : categoryColor ? categoryColor + "30" : "action.hover",
            borderColor: isOverdue && !isPlanned ? "error.main" : undefined,
            borderWidth: isOverdue && !isPlanned ? 1.5 : undefined,
            "&:hover": { filter: "brightness(0.95)" },
          }}
        >
          <Typography variant="body2" fontWeight={500} noWrap>
            {level > 0 ? "└ " : ""}{isPlanned ? "□" : "■"} {task.title}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.25 }}>
            {task.pomodoros != null && (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
                {task.pomodoros} Pomo
              </Typography>
            )}
            {plannedDate && (
              <Typography variant="caption" color={isOverdue ? "error.main" : "text.disabled"}>
                {formatPlannedDate(plannedDate)}
              </Typography>
            )}
            {occurrenceDate && (
              <Chip
                size="small"
                label={`Fällig: ${new Date(occurrenceDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`}
                onDelete={occurrenceId ? () => handleRemoveOccurrence(occurrenceId, task.id) : undefined}
                sx={{ fontSize: 10, height: 18 }}
              />
            )}
            {isOverdue && (
              <Typography variant="caption" color="error.main" fontWeight={600}>
                überfällig
              </Typography>
            )}
          </Stack>
        </Paper>
        {childEntries.map((child) => renderDayTask(child, level + 1, dayDate))}
      </Box>
    );
  }

  const getChildEntries = (parentId: string, dayDate: string): DayTaskEntry[] => {
    const result: DayTaskEntry[] = [];
    for (const task of tasksWithMeta) {
      if (task.isCompleted) continue;
      if (task.parentId !== parentId) continue;

      const effectivePlanned = getEffectivePlannedDate(task.id);
      if (!effectivePlanned) continue;
      if (isoDateOnly(new Date(effectivePlanned)) !== dayDate) continue;

      result.push({ task, plannedDate: effectivePlanned, type: "planned", occurrenceId: null, occurrenceDate: null });
    }
    return result;
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton onClick={prevWeek}><ChevronLeft /></IconButton>
          <Typography variant="h5" fontWeight={600} sx={{ minWidth: 220, textAlign: "center" }}>
            KW {Math.ceil((currentMonday.getTime() - new Date(currentMonday.getFullYear(), 0, 1).getTime()) / 604800000) || 1} – {formatDateRange(currentMonday, weekEnd)}
          </Typography>
          <IconButton onClick={nextWeek}><ChevronRight /></IconButton>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <CircularProgress size={24} sx={{ mb: 1 }} />}

      {horizonWarnings.length > 0 && !loading && (
        <Stack spacing={0.5} mb={2}>
          {horizonWarnings.map((hw, i) => (
            <Alert key={i} severity="warning" variant="outlined" sx={{ py: 0 }}>
              {`Bis ${new Date(hw.deadlineDate).toLocaleDateString("de-DE")}: ${hw.requiredSp} Pomodori fällig, nur ${hw.availableSp} Pomodori Kapazität (–${hw.shortfall})`}
            </Alert>
          ))}
        </Stack>
      )}

      {!loading && !error && (
        <Stack direction="row" spacing={2} sx={{ height: "calc(100vh - 280px)" }}>
          <Box sx={{ flex: 1, display: "flex", gap: 1, overflowX: "auto", pb: 1 }}>
            {days.map((day) => {
              const isPast = day.date < todayStr;
              const dayTasks = getDayTasks(day.date);
              const dayDate = new Date(day.date);

              return (
                <Paper
                  key={day.date}
                  variant="outlined"
                  sx={{
                    minWidth: 160, flex: 1, display: "flex", flexDirection: "column",
                    opacity: isPast ? 0.55 : 1,
                    bgcolor: day.date === todayStr ? "primary.light" : "background.paper",
                    borderColor: day.date === todayStr ? "primary.main" : "divider",
                    pointerEvents: isPast ? "none" : "auto",
                  }}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const raw = e.dataTransfer.getData("text/task-ids");
                    if (raw) {
                      try {
                        const ids = JSON.parse(raw) as string[];
                        dropOnDay(ids, day.date);
                      } catch {
                        const single = e.dataTransfer.getData("text/task-id");
                        if (single) dropOnDay([single], day.date);
                      }
                    }
                  }}
                >
                  <Box sx={{ p: 1, pb: 0.5 }}>
                    <Typography variant="caption" fontWeight={day.date === todayStr ? 700 : 600} color={day.date === todayStr ? "primary.contrastText" : undefined}>
                      {WEEKDAYS_SHORT[dayDate.getDay()]}, {dayDate.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                    </Typography>
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
                      {day.usedSp} / {day.capacity} Pomo {day.overloaded ? "⚠" : day.usedSp === day.capacity && day.capacity > 0 ? "✓" : ""}
                    </Typography>
                    {day.capacity > 0 && (
                      <Box sx={{ mt: 0.5, height: 4, borderRadius: 2, bgcolor: "action.hover", overflow: "hidden" }}>
                        <Box
                          sx={{
                            height: "100%", borderRadius: 2, transition: "width 200ms",
                            width: `${Math.min((day.usedSp / day.capacity) * 100, 100)}%`,
                            bgcolor: day.overloaded ? "error.main" : day.usedSp / day.capacity > 0.8 ? "warning.main" : "success.main",
                          }}
                        />
                      </Box>
                    )}
                  </Box>

                  <Box sx={{ flex: 1, p: 0.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
                    {dayTasks.map((entry) => renderDayTask(entry, 0, day.date))}
                    {dayTasks.length === 0 && !isPast && (
                      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px dashed", borderColor: "divider", borderRadius: 1, m: 0.5 }}>
                        <Typography variant="caption" color="text.disabled">
                          Aufgabe hier ablegen
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Paper>
              );
            })}
          </Box>

          <Box sx={{ width: 380, flexShrink: 0, display: "flex", flexDirection: "column" }}>
            <TaskTree
              tasks={tasksWithMeta}
              draggable
              onTaskClick={(taskId) => push({ id: taskId, title: tasksWithMeta.find((t) => t.id === taskId)?.title ?? "" })}
              showFilters
              showPomodoros
              showPlannedDate
              categories={categories}
              users={users}
              title="Aufgaben"
            />
          </Box>
        </Stack>
      )}

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }} spacing={2}>
        <Box>
          {hasUnconfirmed && (
            <Typography variant="caption" color="warning.main">
              {draft ? Object.keys(draft.changes).length : 0} unbestätigte Änderungen
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" color="inherit" onClick={handleDiscard} disabled={!hasUnconfirmed || saving}>
            ⟳ Verwerfen
          </Button>
          <Button variant="contained" onClick={handleConfirm} disabled={!hasUnconfirmed || saving}>
            {saving ? "Speichert..." : `✓ Planung bestätigen${draft ? ` (${Object.keys(draft.changes).length} Änderungen)` : ""}`}
          </Button>
        </Stack>
      </Stack>

      <Dialog open={confirmDialogOpen} onClose={() => setConfirmDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Planung bestätigen</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Folgende Änderungen werden angewendet:
          </Typography>
          <Box sx={{ maxHeight: 320, overflow: "auto", mt: 1 }}>
            {draft && Object.entries(draft.changes).map(([taskId, newDate]) => {
              const task = tasksWithMeta.find((t) => t.id === taskId);
              const oldDate = task?.plannedDate;
              const titleStr = task?.title ?? taskId.slice(0, 8);
              return (
                <Box key={taskId} sx={{ py: 0.5, borderBottom: 1, borderColor: "divider" }}>
                  <Typography variant="body2" noWrap>{titleStr}</Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {oldDate && (
                      <Chip size="small" label={`vorher: ${formatPlannedDate(oldDate)}`} variant="outlined" color="default" sx={{ fontFamily: "JetBrains Mono, monospace" }} />
                    )}
                    {newDate ? (
                      <Chip size="small" label={`neu: ${formatPlannedDate(newDate)}`} color="primary" sx={{ fontFamily: "JetBrains Mono, monospace" }} />
                    ) : (
                      <Chip size="small" label="Planung entfernt" color="default" variant="outlined" />
                    )}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialogOpen(false)}>Abbrechen</Button>
          <Button variant="contained" onClick={handleConfirmExecute} disabled={saving}>
            {saving ? "Speichert..." : "✓ Jetzt anwenden"}
          </Button>
        </DialogActions>
      </Dialog>

      {occurrenceTask && (
        <Dialog open={occurrenceDialogOpen} onClose={() => setOccurrenceDialogOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Wiederkehrende Aufgabe planen</DialogTitle>
          <DialogContent>
            <Stack spacing={2} mt={1}>
              <Typography variant="body2">
                "{occurrenceTask.title}" für den {new Date(occurrenceTargetDate).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })} planen.
              </Typography>
              <OccurrencePicker
                taskId={occurrenceTask.id}
                value={occurrenceDate}
                onChange={setOccurrenceDate}
                label="Welche Fälligkeit planen?"
              />
              <Stack direction="row" justifyContent="flex-end" gap={1}>
                <Button onClick={() => setOccurrenceDialogOpen(false)}>Abbrechen</Button>
                <Button variant="contained" onClick={handleOccurrencePlan} disabled={!occurrenceDate}>
                  Planen
                </Button>
              </Stack>
            </Stack>
          </DialogContent>
        </Dialog>
      )}
    </Box>
  );
}
