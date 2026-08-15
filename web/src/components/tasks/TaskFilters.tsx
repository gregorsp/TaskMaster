import type { ReactNode } from "react";
import {
  Box, TextField, Select, MenuItem, FormControl, InputLabel, Stack, Chip, Checkbox, Button, Badge,
} from "@mui/material";
import type { Category } from "../../api/categoriesApi";
import type { UserPickerItem } from "../../api/usersApi";
import type { TaskFilterState } from "./taskFilterModel";

export interface TaskFiltersVisibility {
  search?: boolean;
  status?: boolean;
  category?: boolean;
  assignee?: boolean;
  habit?: boolean;
  overdue?: boolean;
  sort?: boolean;
  completedDisplay?: boolean;
}

interface TaskFiltersProps {
  filters: TaskFilterState;
  onChange: (patch: Partial<TaskFilterState>) => void;
  onReset: () => void;
  activeCount: number;
  categories?: Category[];
  users?: UserPickerItem[];
  show?: TaskFiltersVisibility;
  headerActions?: ReactNode;
  overdueCount?: number;
}

const DEFAULT_SHOW: Required<TaskFiltersVisibility> = {
  search: true,
  status: true,
  category: true,
  assignee: true,
  habit: true,
  overdue: true,
  sort: true,
  completedDisplay: true,
};

export function TaskFilters({
  filters, onChange, onReset, activeCount, categories, users, show, headerActions, overdueCount,
}: TaskFiltersProps) {
  const visible = { ...DEFAULT_SHOW, ...show };
  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  const statusChanged = (v: TaskFilterState["status"]) => onChange({ status: v });
  const categoryChanged = (v: string) => onChange({ categoryId: v });
  const habitChanged = (v: TaskFilterState["habit"]) => onChange({ habit: v });
  const assigneeChanged = (v: string[]) => onChange({ assigneeIds: v });
  const sortChanged = (v: string) => {
    const [s, o] = v.split("-") as [TaskFilterState["sort"], TaskFilterState["order"]];
    onChange({ sort: s, order: o });
  };
  const completedChanged = (v: TaskFilterState["completedDisplay"]) => onChange({ completedDisplay: v });

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
      {visible.search && (
        <TextField
          size="small"
          placeholder="Suchen..."
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          sx={{ minWidth: 160, flex: 1 }}
        />
      )}

      {visible.status && (
        <FormControl size="small" sx={{ minWidth: 110 }}>
          <InputLabel>Status</InputLabel>
          <Select value={filters.status} label="Status" onChange={(e) => statusChanged(e.target.value as TaskFilterState["status"])}>
            <MenuItem value="open">Offen</MenuItem>
            <MenuItem value="done">Erledigt</MenuItem>
            <MenuItem value="all">Alle</MenuItem>
          </Select>
        </FormControl>
      )}

      {visible.category && categories && (
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Kategorie</InputLabel>
          <Select value={filters.categoryId} label="Kategorie" onChange={(e) => categoryChanged(e.target.value)}>
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
      )}

      {visible.assignee && users && (
        <FormControl size="small" sx={{ minWidth: 160, maxWidth: 260 }}>
          <InputLabel>Nutzer</InputLabel>
          <Select
            multiple
            value={filters.assigneeIds}
            label="Nutzer"
            onChange={(e) => assigneeChanged(e.target.value as string[])}
            renderValue={(selected) => selected.map((id) => userById.get(id)?.displayName ?? id).join(", ")}
            MenuProps={{ PaperProps: { style: { maxHeight: 300 } } }}
          >
            {users.map((u) => (
              <MenuItem key={u.id} value={u.id}>
                <Checkbox checked={filters.assigneeIds.includes(u.id)} size="small" />
                {u.displayName}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {visible.habit && (
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Habits</InputLabel>
          <Select value={filters.habit} label="Habits" onChange={(e) => habitChanged(e.target.value as TaskFilterState["habit"])}>
            <MenuItem value="all">Alle anzeigen</MenuItem>
            <MenuItem value="habits">Nur Habits</MenuItem>
            <MenuItem value="no_habits">Ohne Habits</MenuItem>
          </Select>
        </FormControl>
      )}

      {visible.overdue && (
        <Badge badgeContent={overdueCount ?? 0} color="error" invisible={!overdueCount}>
          <Chip
            label="Überfällig"
            onClick={() => onChange({ overdue: !filters.overdue })}
            color={filters.overdue ? "error" : "default"}
            variant={filters.overdue ? "filled" : "outlined"}
          />
        </Badge>
      )}

      {visible.sort && (
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Sortierung</InputLabel>
          <Select value={`${filters.sort}-${filters.order}`} label="Sortierung" onChange={(e) => sortChanged(e.target.value)}>
            <MenuItem value="createdAt-desc">Neueste zuerst</MenuItem>
            <MenuItem value="createdAt-asc">Älteste zuerst</MenuItem>
            <MenuItem value="dueAt-asc">Fälligkeit aufsteigend</MenuItem>
            <MenuItem value="dueAt-desc">Fälligkeit absteigend</MenuItem>
            <MenuItem value="title-asc">Titel A–Z</MenuItem>
          </Select>
        </FormControl>
      )}

      {visible.completedDisplay && (
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Erledigte</InputLabel>
          <Select value={filters.completedDisplay} label="Erledigte" onChange={(e) => completedChanged(e.target.value as TaskFilterState["completedDisplay"])}>
            <MenuItem value="hide_completed">ausblenden</MenuItem>
            <MenuItem value="show_all">alle anzeigen</MenuItem>
            <MenuItem value="hide_if_incomplete_parent">nur wenn Eltern erledigt</MenuItem>
          </Select>
        </FormControl>
      )}

      {activeCount > 0 && (
        <Button size="small" color="inherit" onClick={onReset} sx={{ textTransform: "none" }}>
          Filter zurücksetzen ({activeCount})
        </Button>
      )}

      {headerActions}
    </Stack>
  );
}
