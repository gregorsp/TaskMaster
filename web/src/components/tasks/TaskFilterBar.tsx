import { useState } from "react";
import {
  Box, TextField, FormControl, InputLabel, Select, MenuItem,
  Checkbox, Chip, Badge, Button, Stack,
} from "@mui/material";
import { FilterList as FilterListIcon } from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import { useMediaQuery } from "@mui/material";
import type { Category } from "../../api/categoriesApi";
import type { TaskContext } from "../../api/contextsApi";
import type { UserPickerItem } from "../../api/usersApi";
import type { TaskStatus } from "../../api/tasksApi";
import { STATUS_LABELS, labelEntries } from "./gtd";

export type PriorityFilter = "" | "important" | "urgent" | "both";

export interface TaskFilterState {
  search: string;
  status: "all" | "open" | "done";
  gtdStatus: "" | TaskStatus;
  priority: PriorityFilter;
  categoryId: string;
  contextId: string;
  assigneeIds: string[];
  habitFilter: "all" | "habits" | "no_habits";
  isOverdue: boolean;
  sort: "createdAt" | "dueAt";
  sortOrder: "asc" | "desc";
  hidePlanned: boolean;
  completionMode: "hide_completed" | "show_all" | "hide_if_incomplete_parent";
}

export function createDefaultTaskFilterState(): TaskFilterState {
  return {
    search: "",
    status: "open",
    gtdStatus: "",
    priority: "",
    categoryId: "",
    contextId: "",
    assigneeIds: [],
    habitFilter: "all",
    isOverdue: false,
    sort: "createdAt",
    sortOrder: "desc",
    hidePlanned: false,
    completionMode: "hide_completed",
  };
}

interface TaskFilterBarProps {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  categories: Category[];
  contexts: TaskContext[];
  users: UserPickerItem[];
  showSort?: boolean;
  showStatus?: boolean;
  showGtdStatus?: boolean;
  /** GTD „Erledigen“-Filter: Priorität und Kontext. */
  showEngage?: boolean;
  showHabits?: boolean;
  showPlanned?: boolean;
  showCompletionMode?: boolean;
  overdueCount?: number;
}

export function TaskFilterBar({
  value, onChange, categories, contexts, users,
  showSort = true, showStatus = true, showGtdStatus = true, showEngage = true, showHabits = true, showPlanned = true,
  showCompletionMode = false, overdueCount,
}: TaskFilterBarProps) {
  showGtdStatus = showGtdStatus && showEngage;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [open, setOpen] = useState(false);

  const userById = new Map(users.map((u) => [u.id, u]));

  const activeFilterCount = [
    value.search.trim() !== "",
    showStatus && value.status !== "open",
    showGtdStatus && value.gtdStatus !== "",
    showEngage && value.priority !== "",
    value.categoryId !== "",
    showEngage && value.contextId !== "",
    value.assigneeIds.length > 0,
    showHabits && value.habitFilter !== "all",
    value.isOverdue,
    showSort && (value.sort !== "createdAt" || value.sortOrder !== "desc"),
    showPlanned && value.hidePlanned,
    showCompletionMode && value.completionMode !== "hide_completed",
  ].filter(Boolean).length;

  const update = (patch: Partial<TaskFilterState>) => onChange({ ...value, ...patch });

  return (
    <Box>
      {isMobile && (
        <Button
          variant="outlined"
          startIcon={<FilterListIcon />}
          onClick={() => setOpen((o) => !o)}
          sx={{ mb: 2 }}
        >
          Suchen & Filtern
          {activeFilterCount > 0 && <Badge badgeContent={activeFilterCount} color="error" sx={{ ml: 1 }} />}
        </Button>
      )}

      {(!isMobile || open) && (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mb={2} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            placeholder="Suchen..."
            value={value.search}
            onChange={(e) => update({ search: e.target.value })}
            sx={{ minWidth: 200 }}
          />

          {showStatus && (
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>Status</InputLabel>
              <Select
                value={value.status}
                label="Status"
                onChange={(e) => update({ status: e.target.value as TaskFilterState["status"] })}
              >
                <MenuItem value="open">Offen</MenuItem>
                <MenuItem value="done">Erledigt</MenuItem>
                <MenuItem value="all">Alle</MenuItem>
              </Select>
            </FormControl>
          )}

          {showGtdStatus && (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>GTD-Status</InputLabel>
              <Select
                value={value.gtdStatus}
                label="GTD-Status"
                onChange={(e) => update({ gtdStatus: e.target.value as TaskFilterState["gtdStatus"] })}
              >
                <MenuItem value="">Alle</MenuItem>
                {labelEntries(STATUS_LABELS).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
              </Select>
            </FormControl>
          )}

          {showEngage && (
            <>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Priorität</InputLabel>
                <Select
                  value={value.priority}
                  label="Priorität"
                  onChange={(e) => update({ priority: e.target.value as PriorityFilter })}
                >
                  <MenuItem value="">Alle</MenuItem>
                  <MenuItem value="important">Wichtig</MenuItem>
                  <MenuItem value="urgent">Dringend</MenuItem>
                  <MenuItem value="both">Wichtig & dringend</MenuItem>
                </Select>
              </FormControl>
            </>
          )}

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Kategorie</InputLabel>
            <Select
              value={value.categoryId}
              label="Kategorie"
              onChange={(e) => update({ categoryId: e.target.value })}
            >
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

          {showEngage && (
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Kontext</InputLabel>
              <Select
                value={value.contextId}
                label="Kontext"
                onChange={(e) => update({ contextId: e.target.value })}
              >
                <MenuItem value="">Alle</MenuItem>
                {contexts.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: c.color }} />
                      {c.name}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControl size="small" sx={{ minWidth: 200, maxWidth: 320 }}>
            <InputLabel>Nutzer</InputLabel>
            <Select
              multiple
              value={value.assigneeIds}
              label="Nutzer"
              onChange={(e) => update({ assigneeIds: e.target.value as string[] })}
              renderValue={(selected) => selected.map((id) => userById.get(id)?.displayName ?? id).join(", ")}
              MenuProps={{ PaperProps: { style: { maxHeight: 300 } } }}
            >
              {users.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  <Checkbox checked={value.assigneeIds.includes(u.id)} size="small" />
                  {u.displayName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {showHabits && (
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Habits</InputLabel>
              <Select
                value={value.habitFilter}
                label="Habits"
                onChange={(e) => update({ habitFilter: e.target.value as TaskFilterState["habitFilter"] })}
              >
                <MenuItem value="all">Alle anzeigen</MenuItem>
                <MenuItem value="habits">Nur Habits</MenuItem>
                <MenuItem value="no_habits">Ohne Habits</MenuItem>
              </Select>
            </FormControl>
          )}

          {overdueCount !== undefined && overdueCount > 0 ? (
            <Badge badgeContent={overdueCount} color="error">
              <Chip
                label="Überfällig"
                onClick={() => update({ isOverdue: !value.isOverdue })}
                color={value.isOverdue ? "error" : "default"}
                variant={value.isOverdue ? "filled" : "outlined"}
              />
            </Badge>
          ) : (
            <Chip
              label="Überfällig"
              onClick={() => update({ isOverdue: !value.isOverdue })}
              color={value.isOverdue ? "error" : "default"}
              variant={value.isOverdue ? "filled" : "outlined"}
            />
          )}

          {showSort && (
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Sortierung</InputLabel>
              <Select
                value={`${value.sort}-${value.sortOrder}`}
                label="Sortierung"
                onChange={(e) => {
                  const [sort, sortOrder] = e.target.value.split("-") as [TaskFilterState["sort"], TaskFilterState["sortOrder"]];
                  update({ sort, sortOrder });
                }}
              >
                <MenuItem value="createdAt-desc">Neueste zuerst</MenuItem>
                <MenuItem value="createdAt-asc">Alteste zuerst</MenuItem>
                <MenuItem value="dueAt-asc">Fälligkeit aufsteigend</MenuItem>
                <MenuItem value="dueAt-desc">Fälligkeit absteigend</MenuItem>
              </Select>
            </FormControl>
          )}

          {showPlanned && (
            <Chip
              label="Geplante ausblenden"
              onClick={() => update({ hidePlanned: !value.hidePlanned })}
              color={value.hidePlanned ? "primary" : "default"}
              variant={value.hidePlanned ? "filled" : "outlined"}
            />
          )}

          {showCompletionMode && (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Erledigte</InputLabel>
              <Select
                value={value.completionMode}
                label="Erledigte"
                onChange={(e) => update({ completionMode: e.target.value as TaskFilterState["completionMode"] })}
              >
                <MenuItem value="hide_completed">ausblenden</MenuItem>
                <MenuItem value="show_all">alle anzeigen</MenuItem>
                <MenuItem value="hide_if_incomplete_parent">nur wenn Eltern erledigt</MenuItem>
              </Select>
            </FormControl>
          )}
        </Stack>
      )}
    </Box>
  );
}
