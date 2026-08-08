import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, TextField, Select, MenuItem, FormControl, InputLabel,
  Stack, Button, Pagination,
} from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { listTasks, type Task } from "../api/tasksApi";
import { listCategories, type Category } from "../api/categoriesApi";
import { TaskListView } from "../components/tasks/TaskListView";
import { TaskForm } from "../components/tasks/TaskForm";
import { useNotify } from "../context/NotifyContext";

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
  const [taskFormOpen, setTaskFormOpen] = useState(false);
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

      <TaskListView tasks={tasks} onUpdated={fetchTasks} />

      {totalPages > 1 && (
        <Stack direction="row" justifyContent="center" mt={2}>
          <Pagination count={totalPages} page={page} onChange={(_, p) => setPage(p)} />
        </Stack>
      )}

      {taskFormOpen && <TaskForm open={taskFormOpen} onClose={() => setTaskFormOpen(false)} onCreated={() => { setTaskFormOpen(false); fetchTasks(); }} />}
    </Box>
  );
}
