import { useState, useEffect } from "react";
import {
  Box, Typography, Stack, Paper, IconButton, CircularProgress,
  ToggleButtonGroup, ToggleButton, FormControl, InputLabel,
  Select, MenuItem, Alert, FormControlLabel, Switch,
} from "@mui/material";
import { ChevronLeft, ChevronRight } from "@mui/icons-material";
import client from "../api/client";
import { useModalStack } from "../components/tasks/ModalStackProvider";
import { listUsers, type User } from "../api/usersApi";
import { useAuth } from "../context/AuthContext";
import { listCategories, type Category } from "../api/categoriesApi";

interface CalendarItem {
  taskId: string;
  title: string;
  date: string;
  color: string | null;
  isCompleted: boolean;
  isOverdue: boolean;
  plannedDate: string | null;
  pomodoros: number | null;
  type: "due" | "planned";
}

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function CalendarPage() {
  const { user } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"month" | "week">("month");
  const [mode, setMode] = useState<"due" | "planned" | "both">("both");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [userIdFilter, setUserIdFilter] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const isAdmin = user?.isAdmin ?? false;

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
    if (isAdmin) listUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const fetchItems = async () => {
    setLoading(true);
    setError("");
    try {
      const from = new Date(year, month, 1).toISOString();
      const to = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
      let url = `/calendar?from=${from}&to=${to}&mode=${mode}`;
      if (userIdFilter) url += `&userId=${userIdFilter}`;
      const { data } = await client.get<CalendarItem[]>(url);
      let filtered = data;
      if (categoryFilter) {
        const taskIdsWithCat: string[] = [];
        for (const item of filtered) {
          try {
            const { data: t } = await client.get<{ categories: { id: string }[] }>(`/tasks/${item.taskId}`);
            if (t.categories?.some((c) => c.id === categoryFilter)) taskIdsWithCat.push(item.taskId);
          } catch { /* skip */ }
        }
        filtered = filtered.filter((i) => taskIdsWithCat.includes(i.taskId));
      }
      setItems(filtered);
    } catch (e) {
      console.error("Calendar fetch failed:", e);
      setError("Fehler beim Laden der Kalenderdaten.");
    }
    setLoading(false);
  };

  useEffect(() => { fetchItems(); }, [year, month, userIdFilter, categoryFilter, mode]);

  const { push, setOnRootUpdated } = useModalStack();
  useEffect(() => {
    setOnRootUpdated(fetchItems);
  }, [fetchItems, setOnRootUpdated]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const prevWeek = () => setCurrentDate(new Date(year, month, currentDate.getDate() - 7));
  const nextWeek = () => setCurrentDate(new Date(year, month, currentDate.getDate() + 7));

  const monday = new Date(currentDate);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekDays: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i); weekDays.push(d);
  }

  const formatHeader = () => {
    if (view === "week") {
      const sun = new Date(monday); sun.setDate(monday.getDate() + 6);
      return `${monday.toLocaleDateString("de-DE", { day: "numeric", month: "short" })} – ${sun.toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return currentDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  };

  const startDay = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const getDayItems = (day: number) => {
    const dayDate = new Date(year, month, day).toDateString();
    return items.filter((i) => {
      if (new Date(i.date).toDateString() !== dayDate) return false;
      if (!showCompleted && i.isCompleted) return false;
      return true;
    });
  };

  const getWeekDayItems = (date: Date) => {
    const ds = date.toDateString();
    return items.filter((i) => {
      if (new Date(i.date).toDateString() !== ds) return false;
      if (!showCompleted && i.isCompleted) return false;
      return true;
    });
  };

  const today = new Date().toDateString();

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton onClick={view === "month" ? prevMonth : prevWeek}><ChevronLeft /></IconButton>
          <Typography variant="h5" fontWeight={600} sx={{ minWidth: { xs: 160, sm: 260 }, textAlign: "center" }}>{formatHeader()}</Typography>
          <IconButton onClick={view === "month" ? nextMonth : nextWeek}><ChevronRight /></IconButton>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControlLabel
            control={<Switch size="small" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />}
            label={<Typography variant="caption">Erledigt</Typography>}
          />
          <ToggleButtonGroup size="small" value={mode} exclusive onChange={(_, v) => v && setMode(v)}>
            <ToggleButton value="due">Fälligkeiten</ToggleButton>
            <ToggleButton value="planned">Geplant</ToggleButton>
            <ToggleButton value="both">Beides</ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup size="small" value={view} exclusive onChange={(_, v) => v && setView(v)}>
            <ToggleButton value="month">Monat</ToggleButton>
            <ToggleButton value="week">Woche</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mb={2}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Kategorie</InputLabel>
          <Select value={categoryFilter} label="Kategorie" onChange={(e) => setCategoryFilter(e.target.value)}>
            <MenuItem value="">Alle</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: c.color }} />{c.name}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {isAdmin && (
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Nutzer</InputLabel>
            <Select value={userIdFilter} label="Nutzer" onChange={(e) => setUserIdFilter(e.target.value)}>
              <MenuItem value="">Eigener</MenuItem>
              {users.map((u) => (<MenuItem key={u.id} value={u.id}>{u.displayName}</MenuItem>))}
            </Select>
          </FormControl>
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <CircularProgress size={24} sx={{ mb: 1 }} />}

      {!loading && !error && items.length === 0 && (
        <Typography color="text.secondary" textAlign="center" py={6}>
          Keine Aufgaben in diesem Zeitraum. Erstelle Aufgaben mit einem Fälligkeitsdatum.
        </Typography>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.5 }}>
        {DAY_NAMES.map((d) => (
          <Typography key={d} variant="caption" textAlign="center" fontWeight={600} color="text.secondary" py={0.5}>{d}</Typography>
        ))}

        {view === "month" ? cells.map((day, idx) => {
          const dayDate = day ? new Date(year, month, day!).toDateString() : "";
          const dayItems = day ? getDayItems(day) : [];
          const isToday = dayDate === today;
          return (
            <Paper
              key={idx}
              variant="outlined"
              sx={{
                minHeight: 80, p: 0.5, fontSize: 11,
                opacity: day ? 1 : 0.3,
                bgcolor: isToday ? "primary.light" : "background.paper",
                borderColor: isToday ? "primary.main" : "divider",
                overflow: "hidden",
              }}
            >
              {day && (
                <>
                  <Typography variant="caption" fontWeight={isToday ? 700 : 600} color={isToday ? "primary.contrastText" : undefined}>
                    {day}
                  </Typography>
                  {dayItems.slice(0, 3).map((item) => {
                    const isDue = item.type === "due";
                    const isPlanned = item.type === "planned";
                    return (
                    <Box
                      key={item.taskId}
                      onClick={() => push({ id: item.taskId, title: item.title })}
                      sx={{
                        py: 0.25, px: 0.5, borderRadius: 0.5, mt: 0.25, cursor: "pointer",
                        fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        textDecoration: item.isCompleted ? "line-through" : undefined,
                        border: isPlanned ? `1.5px dashed ${item.color || "primary.main"}` : undefined,
                        bgcolor: item.isCompleted ? "action.disabledBackground"
                          : item.isOverdue && isDue ? "error.light"
                          : isDue ? (item.color ? item.color + "30" : "primary.light")
                          : "transparent",
                        color: item.isCompleted ? "text.disabled"
                          : item.isOverdue && isDue ? "error.contrastText"
                          : item.color || "primary.dark",
                      }}
                    >
                      {isPlanned ? "□" : "■"} {item.title}
                    </Box>
                    );
                  })}
                  {dayItems.length > 3 && (
                    <Typography variant="caption" color="text.secondary" fontSize={10}>+{dayItems.length - 3} mehr</Typography>
                  )}
                </>
              )}
            </Paper>
          );
        }) : weekDays.map((wd, idx) => {
          const ds = wd.toDateString();
          const dayItems = getWeekDayItems(wd);
          const isToday = ds === today;
          return (
            <Paper
              key={idx}
              variant="outlined"
              sx={{
                minHeight: 120, p: 0.5, fontSize: 11,
                bgcolor: isToday ? "primary.light" : "background.paper",
                borderColor: isToday ? "primary.main" : "divider",
              }}
            >
              <Typography variant="caption" fontWeight={isToday ? 700 : 600}>
                {wd.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}
              </Typography>
              {dayItems.slice(0, 6).map((item) => {
                const isDue = item.type === "due";
                const isPlanned = item.type === "planned";
                return (
                <Box
                  key={item.taskId}
                  onClick={() => push({ id: item.taskId, title: item.title })}
                  sx={{
                    py: 0.25, px: 0.5, borderRadius: 0.5, mt: 0.25, cursor: "pointer",
                    fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    textDecoration: item.isCompleted ? "line-through" : undefined,
                    border: isPlanned ? `1.5px dashed ${item.color || "primary.main"}` : undefined,
                    bgcolor: item.isCompleted ? "action.disabledBackground"
                      : item.isOverdue && isDue ? "error.light"
                      : isDue ? (item.color ? item.color + "30" : "primary.light")
                      : "transparent",
                    color: item.isCompleted ? "text.disabled"
                      : item.isOverdue && isDue ? "error.contrastText"
                      : item.color || "primary.dark",
                  }}
                >
                  {isPlanned ? "□" : "■"} {item.title}
                </Box>
                );
              })}
              {dayItems.length > 6 && (
                <Typography variant="caption" color="text.secondary" fontSize={10}>+{dayItems.length - 6} mehr</Typography>
              )}
            </Paper>
          );
        })}
      </Box>

    </Box>
  );
}
