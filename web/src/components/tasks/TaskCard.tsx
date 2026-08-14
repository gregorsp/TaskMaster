import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, Box, Typography, Chip, IconButton, Stack,
  Button, Divider, TextField, Paper, DialogTitle, DialogActions, Autocomplete,
  Menu, MenuItem, Avatar, Tooltip,
} from "@mui/material";
import {
  Close as CloseIcon, Add as AddIcon,
  Lock as LockIcon, LockOpen as LockOpenIcon, Edit as EditIcon,
  Send as SendIcon, Warning as WarningIcon,
} from "@mui/icons-material";
import { getTask, completeTask, reopenTask, updateTask, deleteTask, getSubtasks, getTaskOccurrences, type TaskWithRelations, type Task } from "../../api/tasksApi";
import { listCategories, type Category } from "../../api/categoriesApi";
import { listUsersPicker, type UserPickerItem } from "../../api/usersApi";
import { TaskForm } from "./TaskForm";
import { TaskRelationsSidebar } from "./TaskRelationsSidebar";
import { CompleteBlockedDialog } from "./CompleteBlockedDialog";
import { OccurrencePicker } from "./OccurrencePicker";
import { hashColor } from "./AssigneeAvatars";
import { useNotify } from "../../context/NotifyContext";
import { useModalStack } from "./ModalStackProvider";
import client from "../../api/client";

interface Props {
  taskId: string;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  onNavigate?: (taskId: string) => void;
  isStacked?: boolean;
  stackDepth?: number;
  isActive?: boolean;
}

interface TaskEvent { id: string; taskId: string; userId: string; type: string; content: string | null; occurrenceDate: string | null; createdAt: string; displayName?: string; profilePicture?: string | null; }

function safeCall(fn: () => Promise<unknown>) {
  fn().catch(e => console.error("TaskCard async error:", e));
}

export function TaskCard({ taskId, open, onClose, onUpdated, onNavigate, isStacked, stackDepth = 0, isActive = true }: Props) {
  const [task, setTask] = useState<TaskWithRelations | null>(null);
  const [allCats, setAllCats] = useState<Category[]>([]);
  const [allUsers, setAllUsers] = useState<UserPickerItem[]>([]);
  const [nextDueOpen, setNextDueOpen] = useState(false);
  const [nextDueDate, setNextDueDate] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [catMenuAnchor, setCatMenuAnchor] = useState<HTMLElement | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [commentText, setCommentText] = useState("");
  const [completeDialog, setCompleteDialog] = useState(false);
  const [completeNote, setCompleteNote] = useState("");
  const [forceCompleteOpen, setForceCompleteOpen] = useState(false);
  const [subtaskOpenCount, setSubtaskOpenCount] = useState(0);
  const [subtaskTotalCount, setSubtaskTotalCount] = useState(0);
  const [subtaskPomodorosTotal, setSubtaskPomodorosTotal] = useState(0);
  const [parentTask, setParentTask] = useState<Task | null>(null);
  const [recurringCompleteOpen, setRecurringCompleteOpen] = useState(false);
  const [recurringOccurrenceDate, setRecurringOccurrenceDate] = useState("");
  const [habitCompleteOpen, setHabitCompleteOpen] = useState(false);
  const [habitCompleteDate, setHabitCompleteDate] = useState("");
  const [habitCompletedToday, setHabitCompletedToday] = useState(false);
  const [cascadeDialogOpen, setCascadeDialogOpen] = useState(false);
  const [completableParent, setCompletableParent] = useState<{ id: string; title: string } | null>(null);
  const notify = useNotify();
  const { push, closeAll } = useModalStack();

  const handleNavigateToTask = (target: Task) => {
    import("../../api/tasksApi").then(({ getTask: gt }) => {
      gt(target.id).then((t) => push(t)).catch(() => {});
    });
  };

  const handleClose = () => {
    if (!isStacked) {
      closeAll();
    }
    onClose();
  };

  const load = async () => {
    try {
      const [t, cats, usrs] = await Promise.all([
        getTask(taskId),
        listCategories().catch(() => []),
        listUsersPicker().catch(() => []),
      ]);
      setTask(t);
      setAllCats(cats);
      setAllUsers(usrs);

      if (t.isHabit) {
        const now = new Date();
        const todayKey = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        getTaskOccurrences(taskId).then((occs) => {
          const doneToday = occs.some((o) => {
            const d = new Date(o.occurrenceDate);
            return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() === todayKey && o.isCompleted;
          });
          setHabitCompletedToday(doneToday);
        }).catch(() => setHabitCompletedToday(false));
      } else {
        setHabitCompletedToday(false);
      }

      if (t.parentId) {
        import("../../api/tasksApi").then(({ getTask: gt }) => {
          gt(t.parentId!).then(setParentTask).catch(() => setParentTask(null));
        });
      } else {
        setParentTask(null);
      }

      client.get(`/tasks/${taskId}/events`).then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => {});

      getSubtasks(taskId).then((r) => {
        setSubtaskOpenCount(r.progress.total - r.progress.completed);
        setSubtaskTotalCount(r.progress.total);
        const pomoSum = r.subtasks.reduce((sum, s) => sum + (s.pomodoros ?? 0), 0);
        setSubtaskPomodorosTotal(pomoSum);
      }).catch((e) => { console.error("getSubtasks error:", e); });
    } catch (e) { console.error("TaskCard load error:", e); }
  };

  useEffect(() => { if (open) load(); }, [open, taskId]);

  const checkParentCompletable = async (parentId: string | null | undefined) => {
    if (!parentId) return;
    try {
      const r = await getSubtasks(parentId);
      if (r.progress.completed === r.progress.total && r.progress.total > 0) {
        import("../../api/tasksApi").then(({ getTask: gt }) => {
          gt(parentId).then((parent) => {
            setCompletableParent({ id: parent.id, title: parent.title });
          }).catch(() => {});
        });
      }
    } catch { /* ignore */ }
  };

  const handleCompleteParent = async () => {
    if (!completableParent) return;
    try {
      const result = await completeTask(completableParent.id, undefined, undefined, false);
      notify("Mutteraufgabe erledigt");
      setCompletableParent(null);
      load();
      onUpdated();
      if (result.parentId) checkParentCompletable(result.parentId);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { code?: string } }; status?: number } };
      if (err?.response?.data?.error?.code === "SUBTASKS_OPEN") {
        notify("Die Mutteraufgabe hat noch offene Unteraufgaben", "error");
      } else {
        notify("Fehler beim Erledigen der Mutteraufgabe", "error");
      }
      console.error(e);
      setCompletableParent(null);
    }
  };

  const handleComplete = async (nextDueAt?: string, occurrenceDate?: string) => {
    try {
      const result = await completeTask(taskId, nextDueAt, completeNote || undefined, undefined, undefined, occurrenceDate);
      notify("Aufgabe erledigt");
      setCompleteDialog(false);
      setRecurringCompleteOpen(false);
      setHabitCompleteOpen(false);
      setCompleteNote("");
      setNextDueOpen(false);
      setRecurringOccurrenceDate("");
      load();
      onUpdated();
      if (result.parentId) checkParentCompletable(result.parentId);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { code?: string; openCount?: number } }; status?: number } };
      const errData = err?.response?.data?.error;
      if (errData?.code === "SUBTASKS_OPEN") {
        setSubtaskOpenCount(errData?.openCount || 0);
        getSubtasks(taskId).then((r) => setSubtaskTotalCount(r.progress.total)).catch(() => {});
        setCascadeDialogOpen(true);
        return;
      }
      console.error(e);
      notify("Fehler beim Erledigen", "error");
    }
  };

  const handleForceComplete = async (note: string, parentOccurrenceDate?: string) => {
    try {
      const result = await completeTask(taskId, undefined, note || undefined, true, undefined, parentOccurrenceDate);
      notify("Aufgabe erledigt (trotz offener Unteraufgaben)");
      setCascadeDialogOpen(false);
      setCompleteNote("");
      load();
      onUpdated();
      if (result.parentId) checkParentCompletable(result.parentId);
    } catch (e) {
      console.error(e);
      notify("Fehler beim Erledigen", "error");
    }
  };

  const handleCascadeComplete = async (note: string, recurringCompletions: Record<string, string>, parentOccurrenceDate?: string) => {
    try {
      const result = await completeTask(taskId, undefined, note || undefined, false, true, parentOccurrenceDate, recurringCompletions);
      notify("Aufgabe und alle Unteraufgaben erledigt");
      setCascadeDialogOpen(false);
      setCompleteNote("");
      load();
      onUpdated();
      if (result.parentId) checkParentCompletable(result.parentId);
    } catch (e) {
      console.error(e);
      notify("Fehler beim Erledigen", "error");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteTask(taskId);
      notify("Aufgabe gelöscht");
      setConfirmDelete(false);
      onClose();
      onUpdated();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { code?: string } }; status?: number } };
      if (err?.response?.data?.error?.code === "HAS_SUBTASKS") {
        notify("Aufgabe hat Unteraufgaben – bitte zuerst diese löschen", "error");
        return;
      }
      console.error(e);
      notify("Fehler beim Löschen", "error");
    }
  };

  const handleSendComment = async () => {
    if (!commentText.trim()) return;
    try { await client.post(`/tasks/${taskId}/comment`, { content: commentText.trim() }); setCommentText(""); load(); }
    catch (e) { console.error(e); notify("Fehler beim Senden", "error"); }
  };

  const fd = (d: string | null) => d ? new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const toInputDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (!task) return null;

  const taskCats = task.categories || [];
  const taskAssignees = task.assignees || [];
  const availCats = allCats.filter(c => !taskCats.find(tc => tc.id === c.id));
  const rt = task.recurrenceType;
  const hasOpenSubtasks = subtaskOpenCount > 0;

  const translateX = isStacked ? -stackDepth * 48 : 0;
  const zIndex = isStacked ? 1300 - stackDepth : 1300;

  return (
    <>
      <Dialog
        open={open}
        onClose={isStacked && !isActive ? undefined : handleClose}
        maxWidth="lg"
        fullWidth
        sx={{
          "& .MuiDialog-paper": {
            transform: isStacked ? `translateX(${translateX}px)` : undefined,
            transition: "transform 0.3s ease",
            opacity: isStacked && !isActive ? 0.7 : 1,
            pointerEvents: isStacked && !isActive ? "none" : "auto",
          },
          zIndex,
        }}
      >
        <DialogContent sx={{ p: 0, display: "flex", flexDirection: { xs: "column", md: "row" } }}>
          {!task.isHabit && (
            <TaskRelationsSidebar
              taskId={taskId}
              parentTask={parentTask}
              onRefresh={() => { load(); onUpdated(); }}
              onNavigateToTask={handleNavigateToTask}
            />
          )}

          <Box sx={{ flex: 1, p: { xs: 2, md: 3 }, minWidth: 0 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
              <Stack direction="row" alignItems="center" gap={1}>
                <Typography variant="h5" fontWeight={600}>{task.title}</Typography>
                {task.isHabit && <Chip size="small" label="Habit" color="success" variant="outlined" />}
                {task.pomodoros != null && task.pomodoros > 0 && (
                  <Tooltip title={`${task.pomodoros} Pomodoro${task.pomodoros > 1 ? "s" : ""} ≈ ${task.pomodoros * 25} Minuten`}>
                    <Chip size="small" label={`${task.pomodoros} Pomo`} color="secondary" />
                  </Tooltip>
                )}
                {subtaskPomodorosTotal > 0 && (
                  <Tooltip title={`${task.pomodoros ?? 0} eigene + ${subtaskPomodorosTotal} aus Unteraufgaben = ${(task.pomodoros ?? 0) + subtaskPomodorosTotal} Pomodoros gesamt`}>
                    <Chip size="small" label={`+${subtaskPomodorosTotal} Pomo`} color="default" variant="outlined" />
                  </Tooltip>
                )}
                <IconButton size="small" onClick={() => setEditOpen(true)}><EditIcon fontSize="small" /></IconButton>
                {!task.isHabit && (
                  <IconButton size="small" onClick={() => safeCall(async () => { await updateTask(taskId, { isPrivate: !task.isPrivate }); setTask({ ...task, isPrivate: !task.isPrivate }); })}>
                    {task.isPrivate ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" color="disabled" />}
                  </IconButton>
                )}
              </Stack>
              <IconButton onClick={handleClose}><CloseIcon /></IconButton>
            </Stack>

            <Stack direction="row" flexWrap="wrap" gap={1} mb={2}>
              {taskCats.map(cat => (
                <Chip key={cat.id} label={cat.name} size="small" sx={{ bgcolor: cat.color + "20", color: cat.color, fontWeight: 500 }}
                  onDelete={() => safeCall(async () => { await updateTask(taskId, { categoryIds: taskCats.filter(c => c.id !== cat.id).map(c => c.id) }); load(); })} />
              ))}
              {availCats.length > 0 && (<>
                <Chip icon={<AddIcon />} label="" size="small" variant="outlined" onClick={e => setCatMenuAnchor(e.currentTarget)} />
                <Menu anchorEl={catMenuAnchor} open={!!catMenuAnchor} onClose={() => setCatMenuAnchor(null)}>
                  {availCats.map(cat => <MenuItem key={cat.id} onClick={() => { safeCall(async () => { await updateTask(taskId, { categoryIds: [...taskCats.map(c => c.id), cat.id] }); load(); }); setCatMenuAnchor(null); }}><Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: cat.color }} />{cat.name}</Box></MenuItem>)}
                </Menu>
              </>)}
            </Stack>

            {task.description && <Typography variant="body2" color="text.secondary" mb={3}>{task.description}</Typography>}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mb={3}>
              <Box sx={{ flex: 1 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="caption" color="text.secondary">Fällig</Typography>
                  <Typography color={task.isOverdue ? "error" : undefined} fontWeight={task.isOverdue ? 600 : undefined}>
                    {task.isHabit ? "Täglich" : task.effectiveDueAt ? fd(task.effectiveDueAt) : task.dueAt ? fd(task.dueAt as string) : "Kein Datum"}
                  </Typography>
                  {task.isOverdue && <Typography variant="caption" color="error">Überfällig</Typography>}
                </Paper>
              </Box>
              {task.plannedDate && (
                <Box sx={{ flex: 1 }}>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">Geplant</Typography>
                    <Typography color={
                      task.dueAt && new Date(task.plannedDate) > new Date(task.dueAt) ? "warning.main" : undefined
                    }>
                      {fd(task.plannedDate)}
                    </Typography>
                    {task.dueAt && new Date(task.plannedDate) > new Date(task.dueAt) && (
                      <Typography variant="caption" color="warning.main">Nach Fälligkeit</Typography>
                    )}
                  </Paper>
                </Box>
              )}
              {rt !== "none" && (
                <Box sx={{ flex: 1 }}>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">Wiederholung</Typography>
                    <Typography variant="body2">{task.recurrenceRule || "Bei Erledigung"}</Typography>
                  </Paper>
                </Box>
              )}
            </Stack>

            {!task.isHabit && (<>
              <Typography variant="subtitle2" mb={1}>Priorität</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5, width: 220, mb: 3 }}>
                {[
                  ["Wichtig + Dringend", true, true],
                  ["Wichtig + Nicht Dringend", true, false],
                  ["Nicht Wichtig + Dringend", false, true],
                  ["Nicht Wichtig + Nicht Dringend", false, false],
                ].map(([label, imp, urg]) => (
                  <Paper key={label as string} variant="outlined" sx={{ p: 1, textAlign: "center", fontSize: 12, cursor: "pointer", bgcolor: task.isImportant === imp && task.isUrgent === urg ? "primary.main" : "transparent", color: task.isImportant === imp && task.isUrgent === urg ? "white" : "text.secondary" }}
                    onClick={() => safeCall(async () => { await updateTask(taskId, { isImportant: !!imp, isUrgent: !!urg }); setTask({ ...task, isImportant: !!imp, isUrgent: !!urg }); })}>
                    {label as string}
                  </Paper>
                ))}
              </Box>
            </>)}

            <Typography variant="subtitle2" mb={1}>Verantwortlich</Typography>
            <Stack direction="row" flexWrap="wrap" gap={1} mb={3} alignItems="center">
              {taskAssignees.map(a =>
                <Chip key={a.id} label={a.displayName} size="small" variant="outlined"
                  avatar={<Avatar src={a.profilePicture ?? undefined} sx={{ width: 22, height: 22, fontSize: 11, bgcolor: hashColor(a.id) }}>{a.displayName?.charAt(0)?.toUpperCase()}</Avatar>}
                  onDelete={() => safeCall(async () => { await updateTask(taskId, { assigneeIds: taskAssignees.filter(x => x.id !== a.id).map(x => x.id) }); load(); })} />
              )}
              <Autocomplete size="small" options={allUsers.filter(u => !taskAssignees.find(a => a.id === u.id))}
                getOptionLabel={u => u.displayName}
                onChange={(_, u) => { if (u) safeCall(async () => { await updateTask(taskId, { assigneeIds: [...taskAssignees.map(a => a.id), u.id] }); load(); }); }}
                renderInput={p => <TextField {...p} placeholder="+ Zuweisen" variant="standard" sx={{ minWidth: 140 }} />} sx={{ minWidth: 150 }} />
            </Stack>

            <Divider sx={{ my: 2 }} />
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Button color="error" size="small" onClick={() => setConfirmDelete(true)}>Löschen</Button>

              {task.isCompleted ? (
                <Button variant="outlined" onClick={async () => { try { await reopenTask(taskId); load(); onUpdated(); } catch (e) { console.error(e); notify("Fehler", "error"); } }}>
                  Wieder öffnen
                </Button>
              ) : task.isHabit && habitCompletedToday ? (
                <Button
                  variant="outlined"
                  onClick={async () => {
                    try {
                      const todayIso = toInputDate(new Date());
                      await reopenTask(taskId, todayIso);
                      setHabitCompletedToday(false);
                      load();
                      onUpdated();
                    } catch (e) { console.error(e); notify("Fehler", "error"); }
                  }}
                >
                  Heute rückgängig
                </Button>
              ) : hasOpenSubtasks && !task.isHabit ? (
                <Stack alignItems="flex-end">
                  <Tooltip title={`${subtaskOpenCount} von ${subtaskTotalCount} Unteraufgaben noch offen`}>
                    <Button
                      variant="contained"
                      color="warning"
                      onClick={() => setCascadeDialogOpen(true)}
                      startIcon={<WarningIcon />}
                    >
                      Erledigen ({subtaskOpenCount}/{subtaskTotalCount} offen)
                    </Button>
                  </Tooltip>
                </Stack>
              ) : (
                <Button
                  variant="contained"
                  onClick={() => {
                    if (task.isHabit) {
                      setHabitCompleteDate(toInputDate(new Date()));
                      setCompleteNote("");
                      setHabitCompleteOpen(true);
                      return;
                    }
                    if (rt === "on_completion") { setNextDueOpen(true); return; }
                    if (rt === "rrule") { setRecurringCompleteOpen(true); return; }
                    setCompleteDialog(true);
                  }}>
                  Erledigen
                </Button>
              )}
            </Stack>
          </Box>

          <Box sx={{ width: { xs: "100%", md: 280 }, borderLeft: { xs: 0, md: 1 }, borderColor: "divider", p: { xs: 2, md: 3 }, bgcolor: "background.paper", display: "flex", flexDirection: "column", maxHeight: { md: "70vh" } }}>
            <Typography variant="subtitle2" fontWeight={600} mb={1}>Verlauf</Typography>
            <Box sx={{ flex: 1, overflowY: "auto", mb: 1 }}>
              {events.length === 0 && <Typography variant="caption" color="text.secondary">Noch keine Einträge.</Typography>}
              {events.map((evt: TaskEvent) => (
                <Box key={evt.id} sx={{ mb: 1.5, pb: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Stack direction="row" alignItems="center" gap={0.75} sx={{ minWidth: 0 }}>
                      <Avatar src={evt.profilePicture ?? undefined} sx={{ width: 20, height: 20, fontSize: 10, bgcolor: hashColor(evt.userId) }}>
                        {evt.displayName?.charAt(0)?.toUpperCase()}
                      </Avatar>
                      <Typography variant="caption" fontWeight={600} sx={{ overflowWrap: "anywhere" }}>
                        {evt.displayName || "?"}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, ml: 1 }}>
                      {new Date(evt.createdAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {evt.type === "completed"
                      ? (evt.occurrenceDate ? `Erledigt – ${fd(evt.occurrenceDate)}` : "Erledigt")
                      : evt.type === "reopened" ? "Wieder geöffnet" : "Kommentar"}
                  </Typography>
                  {evt.content && <Typography variant="body2" sx={{ mt: 0.25 }}>{evt.content}</Typography>}
                </Box>
              ))}
            </Box>
            <Stack direction="row" gap={0.5}>
              <TextField size="small" placeholder="Kommentar..." value={commentText} onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendComment(); } }}
                fullWidth multiline maxRows={3} />
              <IconButton size="small" onClick={handleSendComment} disabled={!commentText.trim()}><SendIcon fontSize="small" /></IconButton>
            </Stack>
          </Box>
        </DialogContent>
      </Dialog>

      <Dialog open={completeDialog} onClose={() => setCompleteDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Aufgabe erledigen</DialogTitle>
        <DialogContent><Stack spacing={2} mt={1}><TextField label="Notiz (optional)" value={completeNote} onChange={e => setCompleteNote(e.target.value)} multiline rows={2} fullWidth /><Stack direction="row" justifyContent="flex-end" gap={1}><Button onClick={() => setCompleteDialog(false)}>Abbrechen</Button><Button variant="contained" onClick={() => handleComplete(undefined)}>Erledigen</Button></Stack></Stack></DialogContent>
      </Dialog>

      {nextDueOpen && (
        <Dialog open={nextDueOpen} onClose={() => setNextDueOpen(false)} maxWidth="xs" fullWidth>
          <DialogContent><Typography variant="h6" mb={2}>Nächstes Mal?</Typography><TextField label="Nächster Termin" type="date" fullWidth InputLabelProps={{ shrink: true }} value={nextDueDate} onChange={e => setNextDueDate(e.target.value)} sx={{ mb: 2 }} /><Stack direction="row" justifyContent="flex-end" gap={1}><Button onClick={() => setNextDueOpen(false)}>Abbrechen</Button><Button variant="contained" onClick={() => handleComplete(nextDueDate || undefined)}>Speichern</Button></Stack></DialogContent>
        </Dialog>
      )}

      {recurringCompleteOpen && (
        <Dialog open={recurringCompleteOpen} onClose={() => setRecurringCompleteOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Aufgabe erledigen</DialogTitle>
          <DialogContent>
            <Stack spacing={2} mt={1}>
              <OccurrencePicker taskId={taskId} value={recurringOccurrenceDate} onChange={setRecurringOccurrenceDate} label="Welche Fälligkeit erledigen?" />
              <TextField label="Notiz (optional)" value={completeNote} onChange={e => setCompleteNote(e.target.value)} multiline rows={2} fullWidth />
              <Stack direction="row" justifyContent="flex-end" gap={1}>
                <Button onClick={() => setRecurringCompleteOpen(false)}>Abbrechen</Button>
                <Button variant="contained" onClick={() => handleComplete(undefined, recurringOccurrenceDate || undefined)}>Erledigen</Button>
              </Stack>
            </Stack>
          </DialogContent>
        </Dialog>
      )}

      {habitCompleteOpen && (
        <Dialog open={habitCompleteOpen} onClose={() => setHabitCompleteOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Habit erledigen</DialogTitle>
          <DialogContent>
            <Stack spacing={2} mt={1}>
              <Typography variant="body2" color="text.secondary">
                Für welchen Tag soll "{task.title}" als erledigt markiert werden?
              </Typography>
              <TextField
                label="Datum"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={habitCompleteDate}
                onChange={e => setHabitCompleteDate(e.target.value)}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  onClick={() => setHabitCompleteDate(toInputDate(new Date()))}
                  disabled={habitCompleteDate === toInputDate(new Date())}
                >
                  Heute
                </Button>
              </Stack>
              <TextField label="Notiz (optional)" value={completeNote} onChange={e => setCompleteNote(e.target.value)} multiline rows={2} fullWidth />
              <Stack direction="row" justifyContent="flex-end" gap={1}>
                <Button onClick={() => setHabitCompleteOpen(false)}>Abbrechen</Button>
                <Button
                  variant="contained"
                  color="success"
                  disabled={!habitCompleteDate}
                  onClick={() => {
                    handleComplete(undefined, habitCompleteDate);
                  }}
                >
                  Erledigen
                </Button>
              </Stack>
            </Stack>
          </DialogContent>
        </Dialog>
      )}

      <CompleteBlockedDialog
        open={cascadeDialogOpen}
        openCount={subtaskOpenCount}
        totalCount={subtaskTotalCount}
        taskId={taskId}
        parentRecurrenceType={task.recurrenceType}
        onClose={() => setCascadeDialogOpen(false)}
        onForceComplete={handleForceComplete}
        onCascadeComplete={handleCascadeComplete}
      />

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Aufgabe löschen?</DialogTitle><DialogActions><Button onClick={() => setConfirmDelete(false)}>Abbrechen</Button><Button onClick={handleDelete} color="error" variant="contained">Löschen</Button></DialogActions>
      </Dialog>

      {editOpen && <TaskForm open={editOpen} task={task} onClose={() => setEditOpen(false)} onCreated={() => { setEditOpen(false); load(); onUpdated(); }} />}

      <Dialog open={!!completableParent} onClose={() => setCompletableParent(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Mutteraufgabe erledigen?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Alle Unteraufgaben von "{completableParent?.title}" sind erledigt. Soll die Mutteraufgabe auch erledigt werden?
          </Typography>
          <Stack direction="row" justifyContent="flex-end" gap={1}>
            <Button onClick={() => setCompletableParent(null)}>Nein</Button>
            <Button variant="contained" onClick={handleCompleteParent}>Ja, erledigen</Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  );
}
