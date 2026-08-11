import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, TextField, Select, MenuItem, FormControl, InputLabel,
  Stack, Button, Pagination, Badge, Chip, Checkbox, useTheme, useMediaQuery, Alert,
} from "@mui/material";
import { Add as AddIcon, FilterList as FilterListIcon } from "@mui/icons-material";
import { listTasks, type Task } from "../api/tasksApi";
import { fetchPlanning } from "../api/planningApi";
import { listCategories, type Category } from "../api/categoriesApi";
import { listUsersPicker, type UserPickerItem } from "../api/usersApi";
import { TaskListView } from "../components/tasks/TaskListView";
import { TaskForm } from "../components/tasks/TaskForm";
import { useNotify } from "../context/NotifyContext";

export function DashboardPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<UserPickerItem[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "done">("open");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [overdueFilter, setOverdueFilter] = useState(false);
  const [habitFilter, setHabitFilter] = useState<"all" | "habits" | "no_habits">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<"createdAt" | "dueAt">("createdAt");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<number>>(new Set());
  const notify = useNotify();

  const fetchTasks = useCallback(async () => {
    try {
      const res = await listTasks({
        page,
        pageSize: 20,
        search: search || undefined,
        isCompleted: statusFilter === "all" ? undefined : statusFilter === "done",
        categoryId: categoryFilter || undefined,
        isOverdue: overdueFilter || undefined,
        isHabit: habitFilter === "all" ? undefined : habitFilter === "habits",
        assigneeIds: assigneeFilter.length > 0 ? assigneeFilter : undefined,
        sort,
        order: sortOrder,
      });
      setTasks(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch {
      notify("Fehler beim Laden der Aufgaben", "error");
    }
  }, [page, search, statusFilter, categoryFilter, overdueFilter, assigneeFilter, sort, sortOrder, habitFilter]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    listUsersPicker().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    listTasks({
      isOverdue: true,
      pageSize: 1,
      search: search || undefined,
      categoryId: categoryFilter || undefined,
      assigneeIds: assigneeFilter.length > 0 ? assigneeFilter : undefined,
    })
      .then((res) => { if (!cancelled) setOverdueCount(res.total); })
      .catch(() => { if (!cancelled) setOverdueCount(0); });
    return () => { cancelled = true; };
  }, [search, categoryFilter, assigneeFilter]);

  useEffect(() => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6).toISOString();
    fetchPlanning(from, to)
      .then((data) => {
        const warnings: string[] = [];
        const todayDay = data.days[0];
        if (todayDay?.overloaded) {
          warnings.push(`Heute: ${todayDay.usedSp}/${todayDay.capacity} Pomodori geplant – ${todayDay.usedSp - todayDay.capacity} über Budget`);
        }
        for (const hw of data.horizonWarnings) {
          const d = new Date(hw.deadlineDate).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
          warnings.push(`Bis ${d}: ${hw.requiredSp} Pomodori fällig, nur ${hw.availableSp} Kapazität (–${hw.shortfall})`);
        }
        setLoadWarnings(warnings);
      })
      .catch(() => setLoadWarnings([]));
  }, []);

  const userById = new Map(users.map((u) => [u.id, u]));

  const activeFilterCount = [
    search.trim() !== "",
    statusFilter !== "open",
    categoryFilter !== "",
    overdueFilter,
    habitFilter !== "all",
    assigneeFilter.length > 0,
  ].filter(Boolean).length;

  const overdueToggle = (
    <Chip
      label="Überfällig"
      onClick={() => { setOverdueFilter((v) => !v); setPage(1); }}
      color={overdueFilter ? "error" : "default"}
      variant={overdueFilter ? "filled" : "outlined"}
    />
  );

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Aufgaben {total > 0 && `(${total})`}</Typography>
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
          {activeFilterCount > 0 && <Badge badgeContent={activeFilterCount} color="error" sx={{ ml: 1 }} />}
        </Button>
      )}

      {(!isMobile || filtersOpen) && (
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
          <FormControl size="small" sx={{ minWidth: 200, maxWidth: 320 }}>
            <InputLabel>Nutzer</InputLabel>
            <Select
              multiple
              value={assigneeFilter}
              label="Nutzer"
              onChange={(e) => { setAssigneeFilter(e.target.value as string[]); setPage(1); }}
              renderValue={(selected) => selected.map((id) => userById.get(id)?.displayName ?? id).join(", ")}
              MenuProps={{ PaperProps: { style: { maxHeight: 300 } } }}
            >
              {users.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  <Checkbox checked={assigneeFilter.includes(u.id)} size="small" />
                  {u.displayName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Habits</InputLabel>
            <Select value={habitFilter} label="Habits" onChange={(e) => { setHabitFilter(e.target.value as typeof habitFilter); setPage(1); }}>
              <MenuItem value="all">Alle anzeigen</MenuItem>
              <MenuItem value="habits">Nur Habits</MenuItem>
              <MenuItem value="no_habits">Ohne Habits</MenuItem>
            </Select>
          </FormControl>
          {overdueCount > 0 ? (
            <Badge badgeContent={overdueCount} color="error">
              {overdueToggle}
            </Badge>
          ) : overdueToggle}
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
      )}

      <TaskListView tasks={tasks} onUpdated={fetchTasks} />

      {loadWarnings.length > 0 && (
        <Stack spacing={0.5} mt={2}>
          {loadWarnings.map((w, i) => dismissedWarnings.has(i) ? null : (
            <Alert key={i} severity="warning" onClose={() => setDismissedWarnings((prev) => new Set(prev).add(i))}>
              {w}
            </Alert>
          ))}
        </Stack>
      )}

      {totalPages > 1 && (
        <Stack direction="row" justifyContent="center" mt={2}>
          <Pagination count={totalPages} page={page} onChange={(_, p) => setPage(p)} />
        </Stack>
      )}

      {taskFormOpen && <TaskForm open={taskFormOpen} onClose={() => setTaskFormOpen(false)} onCreated={() => { setTaskFormOpen(false); fetchTasks(); }} />}
    </Box>
  );
}
