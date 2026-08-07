import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, Box, Typography, Chip, IconButton, Stack,
  Button, Divider, TextField, Paper, DialogTitle, DialogActions, Autocomplete,
  Menu, MenuItem,
} from "@mui/material";
import {
  Close as CloseIcon, Add as AddIcon,
  Lock as LockIcon, LockOpen as LockOpenIcon, Edit as EditIcon,
  Send as SendIcon,
} from "@mui/icons-material";
import { getTask, completeTask, reopenTask, updateTask, deleteTask, type TaskWithRelations } from "../../api/tasksApi";
import { listCategories, type Category } from "../../api/categoriesApi";
import { listUsersPicker, type UserPickerItem } from "../../api/usersApi";
import { TaskForm } from "./TaskForm";
import { useNotify } from "../../context/NotifyContext";
import client from "../../api/client";

interface Props { taskId: string; open: boolean; onClose: () => void; onUpdated: () => void; }
interface TaskEvent { id: string; taskId: string; userId: string; type: string; content: string | null; createdAt: string; }

function safeCall(fn: () => Promise<unknown>) {
  fn().catch(e => console.error("TaskCard async error:", e));
}

export function TaskCard({ taskId, open, onClose, onUpdated }: Props) {
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
  const notify = useNotify();

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
      client.get(`/tasks/${taskId}/events`).then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    } catch (e) { console.error("TaskCard load error:", e); }
  };

  useEffect(() => { if (open) load(); }, [open, taskId]);

  const handleComplete = async (nextDueAt?: string) => {
    try { await completeTask(taskId, nextDueAt, completeNote || undefined); notify("Aufgabe erledigt"); setCompleteDialog(false); setCompleteNote(""); setNextDueOpen(false); load(); onUpdated(); }
    catch (e) { console.error(e); notify("Fehler beim Erledigen", "error"); }
  };
  const handleDelete = async () => {
    try { await deleteTask(taskId); notify("Aufgabe gelöscht"); setConfirmDelete(false); onClose(); onUpdated(); }
    catch (e) { console.error(e); notify("Fehler beim Löschen", "error"); }
  };
  const handleSendComment = async () => {
    if (!commentText.trim()) return;
    try { await client.post(`/tasks/${taskId}/comment`, { content: commentText.trim() }); setCommentText(""); load(); }
    catch (e) { console.error(e); notify("Fehler beim Senden", "error"); }
  };

  const fd = (d: string | null) => d ? new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  if (!task) return null;

  const taskCats = task.categories || [];
  const taskAssignees = task.assignees || [];
  const availCats = allCats.filter(c => !taskCats.find(tc => tc.id === c.id));
  const rt = task.recurrenceType;

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogContent sx={{ p: 0, display: "flex", flexDirection: { xs: "column", md: "row" } }}>
          <Box sx={{ flex: 1, p: { xs: 2, md: 3 }, minWidth: 0 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
              <Stack direction="row" alignItems="center" gap={1}>
                <Typography variant="h5" fontWeight={600}>{task.title}</Typography>
                <IconButton size="small" onClick={() => setEditOpen(true)}><EditIcon fontSize="small" /></IconButton>
                <IconButton size="small" onClick={() => safeCall(async () => { await updateTask(taskId, { isPrivate: !task.isPrivate }); setTask({ ...task, isPrivate: !task.isPrivate }); })}>
                  {task.isPrivate ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" color="disabled" />}
                </IconButton>
              </Stack>
              <IconButton onClick={onClose}><CloseIcon /></IconButton>
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
                    {task.effectiveDueAt ? fd(task.effectiveDueAt) : task.dueAt ? fd(task.dueAt as string) : "Kein Datum"}
                  </Typography>
                  {task.isOverdue && <Typography variant="caption" color="error">Überfällig</Typography>}
                </Paper>
              </Box>
              {rt !== "none" && (
                <Box sx={{ flex: 1 }}>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="caption" color="text.secondary">Wiederholung</Typography>
                    <Typography variant="body2">{task.recurrenceRule || "Bei Erledigung"}</Typography>
                  </Paper>
                </Box>
              )}
            </Stack>

            <Typography variant="subtitle2" mb={1}>Priorität</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5, width: 160, mb: 3 }}>
              {[["Wichtig + Dringend", true], ["Wichtig", true], ["Normal", false]].map(([label, imp]) => (
                <Paper key={label as string} variant="outlined" sx={{ p: 1, textAlign: "center", fontSize: 12, cursor: "pointer", bgcolor: task.isImportant === imp ? "primary.main" : "transparent", color: task.isImportant === imp ? "white" : "text.secondary" }}
                  onClick={() => safeCall(async () => { await updateTask(taskId, { isImportant: !!imp }); setTask({ ...task, isImportant: !!imp }); })}>
                  {label as string}
                </Paper>
              ))}
            </Box>

            <Typography variant="subtitle2" mb={1}>Verantwortlich</Typography>
            <Stack direction="row" flexWrap="wrap" gap={1} mb={3} alignItems="center">
              {taskAssignees.map(a =>
                <Chip key={a.id} label={a.displayName} size="small" variant="outlined"
                  onDelete={() => safeCall(async () => { await updateTask(taskId, { assigneeIds: taskAssignees.filter(x => x.id !== a.id).map(x => x.id) }); load(); })} />
              )}
              <Autocomplete size="small" options={allUsers.filter(u => !taskAssignees.find(a => a.id === u.id))}
                getOptionLabel={u => u.displayName}
                onChange={(_, u) => { if (u) safeCall(async () => { await updateTask(taskId, { assigneeIds: [...taskAssignees.map(a => a.id), u.id] }); load(); }); }}
                renderInput={p => <TextField {...p} placeholder="+ Zuweisen" variant="standard" sx={{ minWidth: 140 }} />} sx={{ minWidth: 150 }} />
            </Stack>

            <Divider sx={{ my: 2 }} />
            <Stack direction="row" justifyContent="space-between">
              <Button color="error" size="small" onClick={() => setConfirmDelete(true)}>Löschen</Button>
              <Button variant={task.isCompleted ? "outlined" : "contained"}
                onClick={async () => {
                  try {
                    if (task.isCompleted) { await reopenTask(taskId); load(); onUpdated(); return; }
                    if (rt === "on_completion") { setNextDueOpen(true); return; }
                    setCompleteDialog(true);
                  } catch (e) { console.error(e); notify("Fehler", "error"); }
                }}>
                {task.isCompleted ? "Wieder öffnen" : "Erledigen"}
              </Button>
            </Stack>
          </Box>

          <Box sx={{ width: { xs: "100%", md: 280 }, borderLeft: { xs: 0, md: 1 }, borderColor: "divider", p: { xs: 2, md: 3 }, bgcolor: "background.paper", display: "flex", flexDirection: "column", maxHeight: { md: "70vh" } }}>
            <Typography variant="subtitle2" fontWeight={600} mb={1}>Verlauf</Typography>
            <Box sx={{ flex: 1, overflowY: "auto", mb: 1 }}>
              {events.length === 0 && <Typography variant="caption" color="text.secondary">Noch keine Einträge.</Typography>}
              {events.map((evt: { id: string; type: string; content: string | null; createdAt: string; displayName?: string }) => (
                <Box key={evt.id} sx={{ mb: 1.5, pb: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="caption" fontWeight={600}>
                      {evt.displayName || "?"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(evt.createdAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {evt.type === "completed" ? "Erledigt" : evt.type === "reopened" ? "Wieder geöffnet" : "Kommentar"}
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

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Aufgabe löschen?</DialogTitle><DialogActions><Button onClick={() => setConfirmDelete(false)}>Abbrechen</Button><Button onClick={handleDelete} color="error" variant="contained">Löschen</Button></DialogActions>
      </Dialog>

      {editOpen && <TaskForm open={editOpen} task={task} onClose={() => setEditOpen(false)} onCreated={() => { setEditOpen(false); load(); onUpdated(); }} />}
    </>
  );
}
