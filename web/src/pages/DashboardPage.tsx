import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, TextField, Select, MenuItem, FormControl, InputLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Chip, IconButton, Pagination, Stack, Button, Dialog, DialogTitle,
  DialogContent, DialogActions, Paper,
} from "@mui/material";
import {
  Add as AddIcon, Lock as LockIcon, Edit as EditIcon, Delete as DeleteIcon,
} from "@mui/icons-material";
import { listTasks, deleteTask, type Task } from "../api/tasksApi";
import { listCategories, type Category } from "../api/categoriesApi";
import { TaskCard } from "../components/tasks/TaskCard";
import { TaskForm } from "../components/tasks/TaskForm";
import { AssigneeAvatars } from "../components/tasks/AssigneeAvatars";
import { useNotify } from "../context/NotifyContext";

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

export function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "done">("open");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sort, setSort] = useState<"createdAt" | "dueAt">("createdAt");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const notify = useNotify();

  const fetchTasks = useCallback(async () => {
    try {
      const res = await listTasks({
        page,
        pageSize: 20,
        search: search || undefined,
        isCompleted: statusFilter === "all" ? undefined : statusFilter === "done",
        categoryId: categoryFilter || undefined,
        sort,
        order: sortOrder,
      });
      setTasks(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch {
      notify("Fehler beim Laden der Aufgaben", "error");
    }
  }, [page, search, statusFilter, categoryFilter, sort, sortOrder]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
  }, []);

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteTask(deleteConfirmId);
      notify("Aufgabe gelöscht");
      setDeleteConfirmId(null);
      fetchTasks();
    } catch {
      notify("Fehler beim Löschen", "error");
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Aufgaben {total > 0 && `(${total})`}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTaskFormOpen(true)}>
          Neue Aufgabe
        </Button>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mb={2} flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          placeholder="Suchen..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          sx={{ minWidth: 200 }}
        />
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Status</InputLabel>
          <Select value={statusFilter} label="Status" onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}>
            <MenuItem value="open">Offen</MenuItem>
            <MenuItem value="done">Erledigt</MenuItem>
            <MenuItem value="all">Alle</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Kategorie</InputLabel>
          <Select value={categoryFilter} label="Kategorie" onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}>
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
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Sortierung</InputLabel>
          <Select value={`${sort}-${sortOrder}`} label="Sortierung" onChange={(e) => { const [s, o] = e.target.value.split("-") as [typeof sort, typeof sortOrder]; setSort(s); setSortOrder(o); }}>
            <MenuItem value="createdAt-desc">Neueste zuerst</MenuItem>
            <MenuItem value="createdAt-asc">Alteste zuerst</MenuItem>
            <MenuItem value="dueAt-asc">Fälligkeit aufsteigend</MenuItem>
            <MenuItem value="dueAt-desc">Fälligkeit absteigend</MenuItem>
          </Select>
        </FormControl>
      </Stack>

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
                {task.dueAt && renderDueDate(task)}
              </Stack>
            )}
            {task.assignees.length > 0 && (
              <Box sx={{ mt: 0.75 }}>
                <AssigneeAvatars assignees={task.assignees} />
              </Box>
            )}
          </Paper>
        ))}
        {tasks.length === 0 && (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography color="text.secondary" textAlign="center">Keine Aufgaben gefunden.</Typography>
          </Paper>
        )}
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
                <TableCell>{renderDueDate(task)}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); setSelectedTaskId(task.id); }}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(task.id); }}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {tasks.length === 0 && (
              <TableRow><TableCell colSpan={3}><Typography color="text.secondary" textAlign="center" py={4}>Keine Aufgaben gefunden.</Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {totalPages > 1 && (
        <Stack direction="row" justifyContent="center" mt={2}>
          <Pagination count={totalPages} page={page} onChange={(_, p) => setPage(p)} />
        </Stack>
      )}

      <Dialog open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)}>
        <DialogTitle>Aufgabe löschen?</DialogTitle>
        <DialogContent>Diese Aktion kann nicht rückgängig gemacht werden.</DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmId(null)}>Abbrechen</Button>
          <Button onClick={handleDelete} color="error" variant="contained">Löschen</Button>
        </DialogActions>
      </Dialog>

      {selectedTaskId && <TaskCard taskId={selectedTaskId} open={!!selectedTaskId} onClose={() => setSelectedTaskId(null)} onUpdated={fetchTasks} />}

      {taskFormOpen && <TaskForm open={taskFormOpen} onClose={() => setTaskFormOpen(false)} onCreated={() => { setTaskFormOpen(false); fetchTasks(); }} />}
    </Box>
  );
}
