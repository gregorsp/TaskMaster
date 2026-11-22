import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Box, Typography,
  Stack, Button, Pagination, Alert, Paper,
} from "@mui/material";
import { Add as AddIcon, FilterList as ReviewIcon, Checklist as ClarifyIcon } from "@mui/icons-material";
import { listTasks, type Task, type TaskDuration, type TaskEnergy, type TaskStatus } from "../../api/tasksApi";
import { fetchPlanning } from "../../api/planningApi";
import { listCategories, type Category } from "../../api/categoriesApi";
import { listContexts, type TaskContext } from "../../api/contextsApi";
import { listUsersPicker, type UserPickerItem } from "../../api/usersApi";
import { TaskListView } from "./TaskListView";
import { TaskForm } from "./TaskForm";
import { TaskFilterBar, createDefaultTaskFilterState, type TaskFilterState } from "./TaskFilterBar";
import { useNotify } from "../../context/NotifyContext";
import { DURATION_LABELS, ENERGY_LABELS, STATUS_LABELS } from "./gtd";
import { QuickCapture } from "./QuickCapture";
import { InboxClarifyDialog } from "./InboxClarifyDialog";
import { WeeklyReviewDialog } from "./WeeklyReviewDialog";

type GtdTab = "" | "inbox" | "project" | TaskStatus;

const isStatusTab = (tab: GtdTab): tab is TaskStatus => tab in STATUS_LABELS;
const isGtdTab = (value: string): value is GtdTab =>
  value === "" || value === "inbox" || value === "project" || value in STATUS_LABELS;

const GTD_TABS: { key: GtdTab; label: string }[] = [
  { key: "", label: "Alle Aufgaben" },
  { key: "inbox", label: "Eingangskorb" },
  { key: "next", label: STATUS_LABELS.next },
  { key: "project", label: "Projekte" },
  { key: "waiting", label: STATUS_LABELS.waiting },
  { key: "someday", label: STATUS_LABELS.someday },
];

interface TaskListPaneProps {
  /** Überschrift über der Liste. */
  title?: string;
  /** Zeigt die GTD-Listen samt Schnellerfassung und Klär-Assistent im Eingangskorb. */
  showGtdTabs?: boolean;
  /** Zeigt den Weekly-Review-Knopf samt Auswertung. */
  showWeeklyReview?: boolean;
}

/**
 * Gemeinsame Aufgabenansicht für Dashboard und GTD-Seite.
 * Die GTD-Unterknöpfe und der Weekly Review erscheinen nur auf der GTD-Seite.
 */
export function TaskListPane({ title = "Aufgaben", showGtdTabs = false, showWeeklyReview = false }: TaskListPaneProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<TaskFilterState>(() => ({
    ...createDefaultTaskFilterState(),
    categoryId: searchParams.get("categoryId") || "",
    contextId: searchParams.get("contextId") || "",
  }));

  useEffect(() => {
    const urlCat = searchParams.get("categoryId") || "";
    const urlCtx = searchParams.get("contextId") || "";
    setFilters((prev) =>
      prev.categoryId === urlCat && prev.contextId === urlCtx ? prev : { ...prev, categoryId: urlCat, contextId: urlCtx }
    );
  }, [searchParams]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contexts, setContexts] = useState<TaskContext[]>([]);
  const [users, setUsers] = useState<UserPickerItem[]>([]);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState<GtdTab>("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [tabsOpen, setTabsOpen] = useState(false);

  const notify = useNotify();
  /** Nur die Antwort der jeweils letzten Anfrage zählt (ältere, langsame Antworten werden verworfen). */
  const latestRequest = useRef(0);

  const selectTab = (next: GtdTab) => { setTab(next); setPage(1); };

  /**
   * Einmalige Vorgaben per Link (z. B. „Jetzt“ aus den Zeitblöcken):
   * ?tab=next&maxDuration=60_min&maxEnergy=high. Sie werden übernommen und
   * danach aus der URL entfernt, damit spätere Filteränderungen frei bleiben.
   */
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const md = searchParams.get("maxDuration");
    const me = searchParams.get("maxEnergy");
    if (tabParam === null && md === null && me === null) return;
    if (showGtdTabs && tabParam !== null && isGtdTab(tabParam)) selectTab(tabParam);
    setFilters((prev) => ({
      ...prev,
      maxDuration: md && md in DURATION_LABELS ? (md as TaskDuration) : "",
      maxEnergy: me && me in ENERGY_LABELS ? (me as TaskEnergy) : "",
    }));
    const rest = new URLSearchParams(searchParams);
    ["tab", "maxDuration", "maxEnergy"].forEach((key) => rest.delete(key));
    setSearchParams(rest, { replace: true });
  }, [searchParams]);

  const handleFilterChange = useCallback((next: TaskFilterState) => {
    setFilters(next);
    const params: Record<string, string> = {};
    if (next.categoryId) params.categoryId = next.categoryId;
    if (next.contextId) params.contextId = next.contextId;
    if (Object.keys(params).length > 0) {
      setSearchParams(params, { replace: true });
    } else if (searchParams.has("categoryId") || searchParams.has("contextId")) {
      setSearchParams({}, { replace: true });
    }
    setPage(1);
  }, []);

  const fetchTasks = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const res = await listTasks({
        page, pageSize: 20,
        search: filters.search ? filters.search.trim() : undefined,
        isCompleted: filters.status === "all" ? undefined : filters.status === "done",
        categoryId: filters.categoryId || undefined,
        contextId: filters.contextId || undefined,
        status: isStatusTab(tab) ? tab : (filters.gtdStatus || undefined),
        maxDuration: filters.maxDuration || undefined,
        maxEnergy: filters.maxEnergy || undefined,
        important: filters.priority === "important" || filters.priority === "both" || undefined,
        urgent: filters.priority === "urgent" || filters.priority === "both" || undefined,
        isProject: tab === "project" ? true : undefined,
        uncategorized: tab === "inbox" ? true : undefined,
        isOverdue: filters.isOverdue || undefined,
        isHabit: filters.habitFilter === "all" ? undefined : filters.habitFilter === "habits",
        assigneeIds: filters.assigneeIds.length > 0 ? filters.assigneeIds : undefined,
        hidePlanned: filters.hidePlanned || undefined,
        sort: filters.sort, order: filters.sortOrder,
      });
      if (requestId !== latestRequest.current) return;
      setTasks(res.items); setTotal(res.total); setTotalPages(res.totalPages);
    } catch { if (requestId === latestRequest.current) notify("Fehler beim Laden der Aufgaben", "error"); }
  }, [page, filters, tab, notify]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  useEffect(() => {
    listCategories().then(setCategories).catch(() => {});
    listContexts().then(setContexts).catch(() => {});
  }, []);

  useEffect(() => {
    listUsersPicker().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    listTasks({
      isOverdue: true,
      pageSize: 1,
      search: filters.search ? filters.search.trim() : undefined,
      categoryId: filters.categoryId || undefined,
      assigneeIds: filters.assigneeIds.length > 0 ? filters.assigneeIds : undefined,
      hidePlanned: filters.hidePlanned || undefined,
    })
      .then((res) => { if (!cancelled) setOverdueCount(res.total); })
      .catch(() => { if (!cancelled) setOverdueCount(0); });
    return () => { cancelled = true; };
  }, [filters]);

  useEffect(() => {
    const toDateOnly = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = new Date();
    const from = toDateOnly(today);
    const to = toDateOnly(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6));
    fetchPlanning(from, to)
      .then((data) => {
        const warnings: string[] = [];
        const todayDay = data.days[0];
        if (todayDay?.overloaded) {
          warnings.push(`Heute: ${todayDay.usedSp}/${todayDay.capacity} Pomodori geplant – ${todayDay.usedSp - todayDay.capacity} über Budget`);
        }
        for (const hw of data.horizonWarnings) {
          const d = new Date(`${hw.deadlineDate}T00:00:00`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
          warnings.push(`Bis ${d}: ${hw.requiredSp} Pomodori fällig, nur ${hw.availableSp} Kapazität (–${hw.shortfall})`);
        }
        setLoadWarnings(warnings);
      })
      .catch(() => setLoadWarnings([]));
  }, []);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h4">{title} {total > 0 && `(${total})`}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTaskFormOpen(true)}>
          Neue Aufgabe
        </Button>
      </Stack>

      {showGtdTabs && (
        <Box mb={2}>
          <Button
            size="small"
            variant="text"
            startIcon={<ReviewIcon />}
            onClick={() => setTabsOpen((open) => !open)}
            sx={{ display: { xs: "inline-flex", md: "none" }, mb: 1 }}
          >
            GTD-Listen
          </Button>
          <Stack
            direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center"
            sx={{ display: { xs: tabsOpen ? "flex" : "none", md: "flex" } }}
          >
            {GTD_TABS.map((entry) => (
              <Button
                key={entry.key || "all"}
                size="small"
                variant={tab === entry.key ? "contained" : "outlined"}
                color={entry.key === "inbox" ? "warning" : "primary"}
                onClick={() => selectTab(entry.key)}
              >
                {entry.label}
              </Button>
            ))}
            {showWeeklyReview && (
              <Button size="small" variant="outlined" color="secondary" onClick={() => setReviewOpen(true)} sx={{ ml: "auto" }}>
                Weekly Review
              </Button>
            )}
          </Stack>
        </Box>
      )}

      {showGtdTabs && tab === "inbox" && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
            <QuickCapture autoFocus onCaptured={() => fetchTasks()} />
            <Button
              variant="contained" color="warning" startIcon={<ClarifyIcon />}
              onClick={() => setClarifyOpen(true)} disabled={total === 0}
              sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
            >
              Eingangskorb klären{total > 0 ? ` (${total})` : ""}
            </Button>
          </Stack>
        </Paper>
      )}

      <TaskFilterBar
        value={filters}
        onChange={handleFilterChange}
        categories={categories}
        contexts={contexts}
        users={users}
        showGtdStatus={!showGtdTabs}
        overdueCount={overdueCount}
      />

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

      {clarifyOpen && (
        <InboxClarifyDialog open={clarifyOpen} onClose={() => setClarifyOpen(false)} onChanged={fetchTasks} />
      )}
      {reviewOpen && (
        <WeeklyReviewDialog
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          onChanged={fetchTasks}
          onClarifyInbox={() => { setReviewOpen(false); selectTab("inbox"); setClarifyOpen(true); }}
          onShowSomeday={() => { setReviewOpen(false); selectTab("someday"); }}
        />
      )}

      {taskFormOpen && <TaskForm open={taskFormOpen} onClose={() => setTaskFormOpen(false)} onCreated={() => { setTaskFormOpen(false); fetchTasks(); }} />}
    </Box>
  );
}
