import { useState, useEffect, useMemo } from "react";
import {
  Dialog, DialogContent, Box, Typography, Chip, IconButton, Stack,
  Button, Divider, TextField, Paper, DialogTitle, DialogActions, Autocomplete,
  Menu, MenuItem, Avatar, Tooltip, LinearProgress, Collapse,
  CircularProgress, Breadcrumbs, Link, ToggleButtonGroup, ToggleButton,
} from "@mui/material";
import {
  Close as CloseIcon, Add as AddIcon,
  Lock as LockIcon, LockOpen as LockOpenIcon, Edit as EditIcon,
  Send as SendIcon,
} from "@mui/icons-material";
import {
  getTask, completeTask, reopenTask, updateTask, deleteTask,
  getSubtasks, getTaskLinks, addTaskLink, removeTaskLink, listTasks, getTaskRelations,
  type TaskWithRelations, type Subtask, type LinkedTask, type Task, type RelationNode,
} from "../../api/tasksApi";
import { listCategories, type Category } from "../../api/categoriesApi";
import { listUsersPicker, type UserPickerItem } from "../../api/usersApi";
import { TaskForm } from "./TaskForm";
import { TaskGraph } from "./TaskGraph";
import { SubtaskList } from "./SubtaskList";
import { RelationTree } from "./RelationTree";
import { hashColor } from "./AssigneeAvatars";
import { useNotify } from "../../context/NotifyContext";
import client from "../../api/client";

interface Props { initialTaskId: string; open: boolean; onClose: () => void; onUpdated: () => void; }
interface TaskEvent { id: string; taskId: string; userId: string; type: string; content: string | null; createdAt: string; displayName?: string; profilePicture?: string | null; }
interface StackEntry { id: string; title: string; }

function safeCall(fn: () => Promise<unknown>) {
  fn().catch(e => console.error("TaskCard async error:", e));
}

export function TaskCard({ initialTaskId, open, onClose, onUpdated }: Props) {
  const [taskStack, setTaskStack] = useState<StackEntry[]>([]);
  const [task, setTask] = useState<TaskWithRelations | null>(null);
  const [allCats, setAllCats] = useState<Category[]>([]);
  const [allUsers, setAllUsers] = useState<UserPickerItem[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>([]);
  const [ancestors, setAncestors] = useState<RelationNode[]>([]);
  const [descendants, setDescendants] = useState<RelationNode[]>([]);
  const [linksByTask, setLinksByTask] = useState<Map<string, RelationNode[]>>(new Map());
  const [graphMode, setGraphMode] = useState<"hint" | "all">("hint");
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [commentText, setCommentText] = useState("");
  const [nextDueOpen, setNextDueOpen] = useState(false);
  const [nextDueDate, setNextDueDate] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [catMenuAnchor, setCatMenuAnchor] = useState<HTMLElement | null>(null);
  const [completeDialog, setCompleteDialog] = useState(false);
  const [completeNote, setCompleteNote] = useState("");
  const [subtaskFormOpen, setSubtaskFormOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkCandidates, setLinkCandidates] = useState<Task[]>([]);
  const [forceDialog, setForceDialog] = useState(false);
  const [forceDialog2, setForceDialog2] = useState(false);
  const [openSubtasks, setOpenSubtasks] = useState<Subtask[]>([]);
  const [showGraphMobile, setShowGraphMobile] = useState(false);
  const notify = useNotify();

  const currentEntry = taskStack[taskStack.length - 1];
  const currentTaskId = currentEntry?.id ?? "";

  useEffect(() => {
    if (open) {
      setTaskStack([{ id: initialTaskId, title: "" }]);
      setShowGraphMobile(false);
    }
  }, [open, initialTaskId]);

  useEffect(() => {
    if (open && currentTaskId) {
      setTask(null);
      setSubtasks([]);
      setProgress({ completed: 0, total: 0 });
      setLinkedTasks([]);
      setAncestors([]);
      setDescendants([]);
      setLinksByTask(new Map());
      setEvents([]);
      load(currentTaskId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentTaskId]);

  const load = async (targetId: string) => {
    try {
      const [t, cats, usrs] = await Promise.all([
        getTask(targetId),
        listCategories().catch(() => []),
        listUsersPicker().catch(() => []),
      ]);
      setTask(t);
      setAllCats(cats);
      setAllUsers(usrs);
      setTaskStack(prev => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], title: t.title };
        return next;
      });
      const [sub, links, relations] = await Promise.all([
        getSubtasks(targetId).catch(() => ({ subtasks: [] as Subtask[], progress: { completed: 0, total: 0 } })),
        getTaskLinks(targetId).catch(() => [] as LinkedTask[]),
        getTaskRelations(targetId).catch(() => ({ ancestors: [], current: null, descendants: [], links: {} })),
      ]);
      setSubtasks(sub.subtasks);
      setProgress(sub.progress);
      setLinkedTasks(links);
      setAncestors(relations.ancestors);
      setDescendants(relations.descendants);
      const linksMap = new Map<string, RelationNode[]>();
      for (const [tid, arr] of Object.entries(relations.links)) {
        linksMap.set(tid, arr);
      }
      setLinksByTask(linksMap);
      client.get(`/tasks/${targetId}/events`).then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    } catch (e) { console.error("TaskCard load error:", e); }
  };

  const handleNavigateTo = (id: string, title: string) => {
    setTaskStack(prev => [...prev, { id, title }]);
  };

  const handleBreadcrumbClick = (index: number) => {
    setTaskStack(prev => prev.slice(0, index + 1));
  };

  const handleComplete = async (nextDueAt?: string, force = false) => {
    try {
      await completeTask(currentTaskId, nextDueAt, completeNote || undefined, force);
      notify("Aufgabe erledigt");
      setCompleteDialog(false); setCompleteNote(""); setNextDueOpen(false);
      setForceDialog(false); setForceDialog2(false); setOpenSubtasks([]);
      load(currentTaskId); onUpdated();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { code?: string; message?: string } } } };
      if (err?.response?.data?.error?.code === "SUBTASKS_OPEN") {
        setOpenSubtasks(subtasks.filter((s) => !s.isCompleted));
        setCompleteDialog(false);
        setForceDialog(true);
      } else {
        console.error(e);
        notify(err?.response?.data?.error?.message || "Fehler beim Erledigen", "error");
      }
    }
  };

  const openLinkDialog = async () => {
    setLinkDialogOpen(true);
    const res = await listTasks({ pageSize: 100, sort: "createdAt" }).catch(() => null);
    if (res) {
      const linkedIds = new Set(linkedTasks.map((lt) => lt.id));
      setLinkCandidates(res.items.filter((t) => t.id !== currentTaskId && !linkedIds.has(t.id)));
    }
  };

  const handleAddLink = async (linkedId: string) => {
    try {
      await addTaskLink(currentTaskId, linkedId);
      setLinkDialogOpen(false);
      notify("Verknüpfung erstellt");
      load(currentTaskId);
    } catch (e) {
      console.error(e);
      notify("Fehler beim Verknüpfen", "error");
    }
  };

  const handleRemoveLink = async (linkedId: string) => {
    try {
      await removeTaskLink(currentTaskId, linkedId);
      notify("Verknüpfung entfernt");
      load(currentTaskId);
    } catch (e) {
      console.error(e);
      notify("Fehler beim Entfernen", "error");
    }
  };

  const handleDelete = async () => {
    try { await deleteTask(currentTaskId); notify("Aufgabe gelöscht"); setConfirmDelete(false); onClose(); onUpdated(); }
    catch (e: unknown) {
      console.error(e);
      const err = e as { response?: { data?: { error?: { code?: string; message?: string } } } };
      notify(err?.response?.data?.error?.message || "Fehler beim Löschen", "error");
    }
  };

  const handleSendComment = async () => {
    if (!commentText.trim()) return;
    try { await client.post(`/tasks/${currentTaskId}/comment`, { content: commentText.trim() }); setCommentText(""); load(currentTaskId); }
    catch (e) { console.error(e); notify("Fehler beim Senden", "error"); }
  };

  const fd = (d: string | null) => d ? new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

  const childrenMap = useMemo(() => {
    const map = new Map<string, RelationNode[]>();
    const push = (parentId: string | null, node: RelationNode) => {
      if (!parentId) return;
      const arr = map.get(parentId) ?? [];
      arr.push(node);
      map.set(parentId, arr);
    };
    for (const a of ancestors) push(a.parentId, a);
    if (task) {
      push(task.parentId, {
        id: task.id, title: task.title, pomodoros: task.pomodoros, isCompleted: task.isCompleted, parentId: task.parentId,
      });
    }
    for (const d of descendants) push(d.parentId, d);
    return map;
  }, [ancestors, descendants, task]);

  const graphEl = task ? (
    graphMode === "all" ? (
      <RelationTree
        nodes={ancestors.length > 0 ? [ancestors[0]] : [{
          id: task.id, title: task.title, pomodoros: task.pomodoros, isCompleted: task.isCompleted, parentId: task.parentId,
        }]}
        childrenMap={childrenMap}
        linksByTask={linksByTask}
        currentId={task.id}
        onNavigate={handleNavigateTo}
      />
    ) : (
      <TaskGraph
        task={{ id: task.id, title: task.title, pomodoros: task.pomodoros, isCompleted: task.isCompleted }}
        ancestors={ancestors}
        subtasks={subtasks}
        linkedTasks={linkedTasks}
        onNavigate={handleNavigateTo}
      />
    )
  ) : null;

  const taskCats = task?.categories || [];
  const taskAssignees = task?.assignees || [];
  const availCats = allCats.filter(c => !taskCats.find(tc => tc.id === c.id));
  const rt = task?.recurrenceType;
  const openCount = progress.total - progress.completed;

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth
        sx={{ "& .MuiDialog-paper": { maxWidth: "min(96vw, 1760px)", width: "100%" } }}>
        <DialogContent sx={{ p: 0, display: "flex", flexDirection: { xs: "column", md: "row" }, maxHeight: { md: "85vh" }, overflow: { md: "hidden" } }}>
          {task && (
            <Box sx={{ display: { xs: "none", md: "block" }, width: 260, flexShrink: 0, borderRight: 1, borderColor: "divider", p: 2, overflowY: "auto" }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="subtitle2">Verbindungen</Typography>
                <ToggleButtonGroup size="small" exclusive value={graphMode} onChange={(_, v) => v && setGraphMode(v)}>
                  <ToggleButton value="hint" sx={{ fontSize: 11, py: 0.25 }}>Übersicht</ToggleButton>
                  <ToggleButton value="all" sx={{ fontSize: 11, py: 0.25 }}>Alle</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              {graphEl}
            </Box>
          )}

          <Box sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3 }, overflowY: { md: "auto" } }}>
            {task ? (
              <>
                {taskStack.length > 1 && (
                  <Breadcrumbs maxItems={5} sx={{ mb: 2, fontSize: 12 }}>
                    {taskStack.map((entry, idx) => {
                      const isLast = idx === taskStack.length - 1;
                      return isLast ? (
                        <Typography key={entry.id} color="text.primary" fontSize={12} fontWeight={600}>{entry.title || "..."}</Typography>
                      ) : (
                        <Link key={entry.id} component="button" underline="hover" color="inherit" fontSize={12}
                          onClick={() => handleBreadcrumbClick(idx)}>
                          {entry.title}
                        </Link>
                      );
                    })}
                  </Breadcrumbs>
                )}

                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
                  <Stack direction="row" alignItems="center" gap={1}>
                    <Typography variant="h5" fontWeight={600}>{task.title}</Typography>
                    {task.pomodoros != null && task.pomodoros > 0 && (
                      <Tooltip title={`${task.pomodoros} Pomodoro${task.pomodoros > 1 ? "s" : ""} ≈ ${task.pomodoros * 25} Minuten`}>
                        <Chip size="small" label={`${task.pomodoros} Pomo`} color="secondary" />
                      </Tooltip>
                    )}
                    <IconButton size="small" onClick={() => setEditOpen(true)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => safeCall(async () => { await updateTask(currentTaskId, { isPrivate: !task.isPrivate }); setTask({ ...task, isPrivate: !task.isPrivate }); })}>
                      {task.isPrivate ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" color="disabled" />}
                    </IconButton>
                  </Stack>
                  <IconButton onClick={onClose}><CloseIcon /></IconButton>
                </Stack>

                <Button size="small" onClick={() => setShowGraphMobile(v => !v)} sx={{ display: { md: "none" }, mb: 1 }}>
                  {showGraphMobile ? "Verbindungen ausblenden" : "Verbindungen anzeigen"}
                </Button>
                <Box sx={{ display: { md: "none" } }}>
                  <Collapse in={showGraphMobile}>
                    <Stack direction="row" justifyContent="flex-end" mb={1}>
                      <ToggleButtonGroup size="small" exclusive value={graphMode} onChange={(_, v) => v && setGraphMode(v)}>
                        <ToggleButton value="hint" sx={{ fontSize: 11, py: 0.25 }}>Übersicht</ToggleButton>
                        <ToggleButton value="all" sx={{ fontSize: 11, py: 0.25 }}>Alle</ToggleButton>
                      </ToggleButtonGroup>
                    </Stack>
                    {graphEl}
                  </Collapse>
                </Box>

                <Stack direction="row" flexWrap="wrap" gap={1} mb={2}>
                  {taskCats.map(cat => (
                    <Chip key={cat.id} label={cat.name} size="small" sx={{ bgcolor: cat.color + "20", color: cat.color, fontWeight: 500 }}
                      onDelete={() => safeCall(async () => { await updateTask(currentTaskId, { categoryIds: taskCats.filter(c => c.id !== cat.id).map(c => c.id) }); load(currentTaskId); })} />
                  ))}
                  {availCats.length > 0 && (<>
                    <Chip icon={<AddIcon />} label="" size="small" variant="outlined" onClick={e => setCatMenuAnchor(e.currentTarget)} />
                    <Menu anchorEl={catMenuAnchor} open={!!catMenuAnchor} onClose={() => setCatMenuAnchor(null)}>
                      {availCats.map(cat => <MenuItem key={cat.id} onClick={() => { safeCall(async () => { await updateTask(currentTaskId, { categoryIds: [...taskCats.map(c => c.id), cat.id] }); load(currentTaskId); }); setCatMenuAnchor(null); }}><Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: cat.color }} />{cat.name}</Box></MenuItem>)}
                    </Menu>
                  </>)}
                </Stack>

                {task.description && <Typography variant="body2" color="text.secondary" mb={2}>{task.description}</Typography>}

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
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5, width: 220, mb: 3 }}>
                  {[
                    ["Wichtig + Dringend", true, true],
                    ["Wichtig + Nicht Dringend", true, false],
                    ["Nicht Wichtig + Dringend", false, true],
                    ["Nicht Wichtig + Nicht Dringend", false, false],
                  ].map(([label, imp, urg]) => (
                    <Paper key={label as string} variant="outlined" sx={{ p: 1, textAlign: "center", fontSize: 12, cursor: "pointer", bgcolor: task.isImportant === imp && task.isUrgent === urg ? "primary.main" : "transparent", color: task.isImportant === imp && task.isUrgent === urg ? "white" : "text.secondary" }}
                      onClick={() => safeCall(async () => { await updateTask(currentTaskId, { isImportant: !!imp, isUrgent: !!urg }); setTask({ ...task, isImportant: !!imp, isUrgent: !!urg }); })}>
                      {label as string}
                    </Paper>
                  ))}
                </Box>

                <Typography variant="subtitle2" mb={1}>Verantwortlich</Typography>
                <Stack direction="row" flexWrap="wrap" gap={1} mb={3} alignItems="center">
                  {taskAssignees.map(a =>
                    <Chip key={a.id} label={a.displayName} size="small" variant="outlined"
                      avatar={<Avatar src={a.profilePicture ?? undefined} sx={{ width: 22, height: 22, fontSize: 11, bgcolor: hashColor(a.id) }}>{a.displayName?.charAt(0)?.toUpperCase()}</Avatar>}
                      onDelete={() => safeCall(async () => { await updateTask(currentTaskId, { assigneeIds: taskAssignees.filter(x => x.id !== a.id).map(x => x.id) }); load(currentTaskId); })} />
                  )}
                  <Autocomplete size="small" options={allUsers.filter(u => !taskAssignees.find(a => a.id === u.id))}
                    getOptionLabel={u => u.displayName}
                    onChange={(_, u) => { if (u) safeCall(async () => { await updateTask(currentTaskId, { assigneeIds: [...taskAssignees.map(a => a.id), u.id] }); load(currentTaskId); }); }}
                    renderInput={p => <TextField {...p} placeholder="+ Zuweisen" variant="standard" sx={{ minWidth: 140 }} />} sx={{ minWidth: 150 }} />
                </Stack>

                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="subtitle2">
                    Unteraufgaben {progress.total > 0 && `(${progress.completed}/${progress.total} erledigt)`}
                  </Typography>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => setSubtaskFormOpen(true)}>Neue Unteraufgabe</Button>
                </Stack>
                {subtasks.length === 0 && (
                  <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                    Noch keine Unteraufgaben. Teile diese Aufgabe in kleinere Schritte auf.
                  </Typography>
                )}
                <Paper variant="outlined" sx={{ mb: 1 }}>
                  <SubtaskList subtasks={subtasks} onNavigate={handleNavigateTo} onChange={() => load(currentTaskId)} />
                </Paper>
                {progress.total > 0 && (
                  <LinearProgress variant="determinate" value={progress.total > 0 ? (progress.completed / progress.total) * 100 : 0} sx={{ mb: 2 }} />
                )}

                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="subtitle2">Verknüpfte Aufgaben</Typography>
                  <Button size="small" startIcon={<AddIcon />} onClick={openLinkDialog}>Verknüpfen</Button>
                </Stack>
                {linkedTasks.length === 0 && (
                  <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                    Keine verknüpften Aufgaben.
                  </Typography>
                )}
                <Stack direction="row" flexWrap="wrap" gap={1} mb={3}>
                  {linkedTasks.map((lt) => (
                    <Chip key={lt.id} label={lt.title} size="small" variant="outlined"
                      color={lt.isCompleted ? "success" : "default"}
                      onClick={() => handleNavigateTo(lt.id, lt.title)}
                      onDelete={() => handleRemoveLink(lt.id)} />
                  ))}
                </Stack>

                <Divider sx={{ my: 2 }} />
                {openCount > 0 && (
                  <Typography variant="caption" color="warning.main" display="block" mb={1}>
                    ⚠ {openCount} Unteraufgabe{openCount > 1 ? "n" : ""} noch offen – beim Erledigen werden sie automatisch mit geschlossen.
                  </Typography>
                )}
                <Stack direction="row" justifyContent="space-between">
                  <Button color="error" size="small" onClick={() => setConfirmDelete(true)}>Löschen</Button>
                  <Button variant={task.isCompleted ? "outlined" : "contained"}
                    onClick={async () => {
                      try {
                        if (task.isCompleted) { await reopenTask(currentTaskId); load(currentTaskId); onUpdated(); return; }
                        if (rt === "on_completion") { setNextDueOpen(true); return; }
                        setCompleteDialog(true);
                      } catch (e) { console.error(e); notify("Fehler", "error"); }
                    }}>
                    {task.isCompleted ? "Wieder öffnen" : "Erledigen"}
                  </Button>
                </Stack>
              </>
            ) : (
              <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 300 }}>
                <CircularProgress />
              </Box>
            )}
          </Box>

          <Box sx={{ width: { xs: "100%", md: 280 }, flexShrink: 0, borderLeft: { xs: 0, md: 1 }, borderColor: "divider", p: { xs: 2, md: 3 }, bgcolor: "background.paper", display: "flex", flexDirection: "column", maxHeight: { md: "85vh" }, overflowY: { md: "auto" } }}>
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

      <Dialog open={forceDialog} onClose={() => setForceDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>⚠ Unteraufgaben offen</DialogTitle>
        <DialogContent>
          <Typography variant="body2" mb={2}>
            {openSubtasks.length} von {subtasks.length} Unteraufgaben sind noch nicht erledigt.
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Sollen die offenen Unteraufgaben automatisch mit erledigt werden?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForceDialog(false)}>Abbrechen</Button>
          <Button variant="contained" color="warning" onClick={() => { setForceDialog(false); setForceDialog2(true); }}>
            Alle miterledigen
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={forceDialog2} onClose={() => setForceDialog2(false)} maxWidth="xs" fullWidth>
        <DialogTitle>⚠⚠ Wirklich alle erledigen?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" mb={1}>Folgende Aufgaben werden als erledigt markiert:</Typography>
          <Box sx={{ pl: 2, mb: 2 }}>
            {openSubtasks.map((st) => (
              <Typography key={st.id} variant="body2">• {st.title}</Typography>
            ))}
          </Box>
          <Typography variant="body2" color="error">Diese Aktion kann nicht rückgängig gemacht werden!</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForceDialog2(false)}>Abbrechen</Button>
          <Button variant="contained" color="error" onClick={() => handleComplete(undefined, true)}>
            Ja, alle erledigen
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={linkDialogOpen} onClose={() => setLinkDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Verknüpfte Aufgabe hinzufügen</DialogTitle>
        <DialogContent>
          <Autocomplete
            options={linkCandidates}
            getOptionLabel={(o) => o.title}
            onChange={(_, v) => { if (v) handleAddLink(v.id); }}
            renderInput={(p) => <TextField {...p} label="Aufgabe suchen" autoFocus />}
          />
        </DialogContent>
        <DialogActions><Button onClick={() => setLinkDialogOpen(false)}>Abbrechen</Button></DialogActions>
      </Dialog>

      {nextDueOpen && (
        <Dialog open={nextDueOpen} onClose={() => setNextDueOpen(false)} maxWidth="xs" fullWidth>
          <DialogContent><Typography variant="h6" mb={2}>Nächstes Mal?</Typography><TextField label="Nächster Termin" type="date" fullWidth InputLabelProps={{ shrink: true }} value={nextDueDate} onChange={e => setNextDueDate(e.target.value)} sx={{ mb: 2 }} /><Stack direction="row" justifyContent="flex-end" gap={1}><Button onClick={() => setNextDueOpen(false)}>Abbrechen</Button><Button variant="contained" onClick={() => handleComplete(nextDueDate || undefined)}>Speichern</Button></Stack></DialogContent>
        </Dialog>
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Aufgabe löschen?</DialogTitle><DialogActions><Button onClick={() => setConfirmDelete(false)}>Abbrechen</Button><Button onClick={handleDelete} color="error" variant="contained">Löschen</Button></DialogActions>
      </Dialog>

      {task && editOpen && <TaskForm open={editOpen} task={task} onClose={() => setEditOpen(false)} onCreated={() => { setEditOpen(false); load(currentTaskId); onUpdated(); }} />}

      {task && subtaskFormOpen && (
        <TaskForm
          open={subtaskFormOpen}
          onClose={() => setSubtaskFormOpen(false)}
          onCreated={() => { setSubtaskFormOpen(false); load(currentTaskId); onUpdated(); }}
          initialParent={{ id: task.id, title: task.title }}
        />
      )}
    </>
  );
}
