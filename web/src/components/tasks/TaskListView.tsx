import { useState, type ReactNode } from "react";
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, Alert, CircularProgress, Chip, IconButton,
  Stack, Dialog, DialogTitle, DialogContent, DialogActions, Button,
} from "@mui/material";
import {
  Lock as LockIcon, Edit as EditIcon, Delete as DeleteIcon,
} from "@mui/icons-material";
import { deleteTask, type Task } from "../../api/tasksApi";
import { TaskCard } from "./TaskCard";
import { AssigneeAvatars } from "./AssigneeAvatars";
import { useNotify } from "../../context/NotifyContext";

const formatDate = (d: string | null) => {
  if (!d) return "";
  return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
};

function renderPriorityChip(task: Task) {
  if (!(task.isImportant || task.isUrgent)) return null;
  const label = task.isImportant && task.isUrgent ? "W+D" : task.isImportant ? "Wichtig" : "Dringend";
  const color = task.isImportant && task.isUrgent ? "error" : task.isImportant ? "warning" : "info";
  return <Chip size="small" label={label} color={color} variant="outlined" />;
}

function renderDueDate(task: Task) {
  const overdue = task.dueAt && new Date(task.dueAt) < new Date() && !task.isCompleted;
  return (
    <Typography variant="body2" color={overdue ? "error" : "text.secondary"} fontWeight={overdue ? 600 : undefined}>
      {formatDate(task.dueAt)}
    </Typography>
  );
}

interface Props {
  tasks: Task[];
  onUpdated: () => void;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  extraBadge?: (task: Task) => ReactNode;
}

export function TaskListView({ tasks, onUpdated, loading, error, emptyText, extraBadge }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const notify = useNotify();

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteTask(deleteConfirmId);
      notify("Aufgabe gelöscht");
      setDeleteConfirmId(null);
      onUpdated();
    } catch {
      notify("Fehler beim Löschen", "error");
    }
  };

  const extra = (task: Task) => (extraBadge ? extraBadge(task) : null);

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <CircularProgress size={24} sx={{ mb: 2 }} />}

      {!loading && !error && tasks.length === 0 && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary" textAlign="center">{emptyText || "Keine Aufgaben gefunden."}</Typography>
        </Paper>
      )}

      {tasks.length > 0 && (
        <>
          <Box sx={{ display: { xs: "block", sm: "none" } }}>
            {tasks.map((task) => (
              <Paper
                key={task.id}
                variant="outlined"
                onClick={() => setSelectedTaskId(task.id)}
                sx={{ p: 1.5, mb: 1, cursor: "pointer", opacity: task.isCompleted ? 0.5 : 1 }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, flex: 1 }}>
                    {task.isPrivate && <LockIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />}
                    <Typography variant="body2" sx={{ overflowWrap: "anywhere", textDecoration: task.isCompleted ? "line-through" : undefined }}>
                      {task.title}
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ flexShrink: 0 }}>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); setSelectedTaskId(task.id); }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(task.id); }}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Stack>
                {(task.isImportant || task.isUrgent || task.dueAt) && (
                  <Stack direction="row" flexWrap="wrap" alignItems="center" gap={0.5} sx={{ mt: 0.75 }}>
                    {renderPriorityChip(task)}
                    {task.dueAt && (
                      <>
                        {renderDueDate(task)}
                        {extra(task)}
                      </>
                    )}
                  </Stack>
                )}
                {task.assignees.length > 0 && (
                  <Box sx={{ mt: 0.75 }}>
                    <AssigneeAvatars assignees={task.assignees} />
                  </Box>
                )}
              </Paper>
            ))}
          </Box>

          <TableContainer sx={{ display: { xs: "none", sm: "block" } }}>
            <Table size="small" sx={{ tableLayout: "fixed" }}>
              <TableHead>
                <TableRow>
                  <TableCell>Titel</TableCell>
                  <TableCell sx={{ width: 110 }}>Fällig</TableCell>
                  <TableCell align="right" sx={{ width: 88 }}>Aktionen</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id} hover onClick={() => setSelectedTaskId(task.id)} sx={{ cursor: "pointer", opacity: task.isCompleted ? 0.5 : 1 }}>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                        {task.isPrivate && <LockIcon fontSize="small" color="action" />}
                        <Typography variant="body2" sx={{ overflowWrap: "anywhere", textDecoration: task.isCompleted ? "line-through" : undefined }}>{task.title}</Typography>
                        <AssigneeAvatars assignees={task.assignees} />
                        {renderPriorityChip(task)}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {renderDueDate(task)}
                      {extra(task)}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); setSelectedTaskId(task.id); }}><EditIcon fontSize="small" /></IconButton>
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(task.id); }}><DeleteIcon fontSize="small" /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      <Dialog open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)}>
        <DialogTitle>Aufgabe löschen?</DialogTitle>
        <DialogContent>Diese Aktion kann nicht rückgängig gemacht werden.</DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmId(null)}>Abbrechen</Button>
          <Button onClick={handleDelete} color="error" variant="contained">Löschen</Button>
        </DialogActions>
      </Dialog>

      {selectedTaskId && <TaskCard taskId={selectedTaskId} open={!!selectedTaskId} onClose={() => setSelectedTaskId(null)} onUpdated={onUpdated} />}
    </Box>
  );
}
