import { useState, useMemo, useCallback, type ReactNode } from "react";
import {
  Box, Typography, TextField, FormControl, InputLabel, Select, MenuItem,
  Stack, Button,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { TaskTreeNode, type TaskWithMeta, type CompletionMode } from "./TaskTreeNode";
import type { Category } from "../../../api/categoriesApi";
import type { UserPickerItem } from "../../../api/usersApi";

export type { CompletionMode, TaskWithMeta } from "./TaskTreeNode";

interface TaskTreeProps {
  tasks: TaskWithMeta[];
  draggable?: boolean;
  onTaskClick?: (taskId: string) => void;
  showFilters?: boolean;
  showPomodoros?: boolean;
  showPlannedDate?: boolean;
  categories?: Category[];
  users?: UserPickerItem[];
  title?: string;
  headerActions?: ReactNode;
}

function buildTree(tasks: TaskWithMeta[]): TaskWithMeta[] {
  const map = new Map<string, TaskWithMeta>();
  const roots: TaskWithMeta[] = [];

  for (const t of tasks) {
    map.set(t.id, { ...t, _children: [] } as any);
  }

  for (const t of map.values()) {
    const parent = t.parentId ? map.get(t.parentId) : undefined;
    if (parent) {
      (parent as any)._children ??= [];
      (parent as any)._children.push(t);
    } else {
      roots.push(t);
    }
  }

  return roots;
}

export function TaskTree({
  tasks, draggable, onTaskClick, showFilters, showPomodoros,
  showPlannedDate, categories, users, title, headerActions,
}: TaskTreeProps) {
  const theme = useTheme();
  const accentColor = theme.palette.primary.main;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [completionMode, setCompletionMode] = useState<CompletionMode>("hide_completed");

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const allParentIds = new Set<string>();
    for (const t of tasks) {
      if (tasks.some((c) => c.parentId === t.id)) {
        allParentIds.add(t.id);
      }
    }
    setExpandedIds(allParentIds);
  }, [tasks]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) => t.title.toLowerCase().includes(q) || (t.description?.toLowerCase().includes(q) ?? false)
      );
    }

    if (categoryFilter) {
      result = result.filter((t) => {
        const cats = (t as any).categories as Category[] | undefined;
        return cats?.some((c) => c.id === categoryFilter);
      });
    }

    if (assigneeFilter) {
      result = result.filter((t) =>
        t.assignees?.some((a) => a.id === assigneeFilter)
      );
    }

    return result;
  }, [tasks, search, categoryFilter, assigneeFilter]);

  const tree = useMemo(() => buildTree(filteredTasks), [filteredTasks]);

  const allExpandable = useMemo(() => {
    const ids = new Set<string>();
    for (const t of filteredTasks) {
      if (filteredTasks.some((c) => c.parentId === t.id)) {
        ids.add(t.id);
      }
    }
    return ids;
  }, [filteredTasks]);

  const taskMap = useMemo(() => {
    const m = new Map<string, TaskWithMeta>();
    for (const t of filteredTasks) m.set(t.id, t);
    return m;
  }, [filteredTasks]);

  const isChainComplete = useCallback(
    (taskId: string | null): boolean => {
      if (!taskId) return true;
      const task = taskMap.get(taskId);
      if (!task) return true;
      if (!task.isCompleted) return false;
      return isChainComplete(task.parentId);
    },
    [taskMap]
  );

  const totalCount = filteredTasks.length;

  return (
    <Box
      sx={{
        border: 1, borderColor: "divider",
        borderRadius: 2, bgcolor: "background.paper",
        overflow: "hidden",
      }}
    >
      {title && (
        <Box sx={{ px: 2, pt: 2, pb: 0 }}>
          <Typography variant="h6" fontWeight={600}>{title}</Typography>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5 }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
              {totalCount} Einträge gesamt
            </Typography>
            <Stack direction="row" gap={1}>
              <Button size="small" variant="outlined" sx={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", textTransform: "none" }} onClick={expandAll}>
                alle aufklappen
              </Button>
              <Button size="small" variant="outlined" sx={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", textTransform: "none" }} onClick={collapseAll}>
                alle zuklappen
              </Button>
            </Stack>
          </Stack>
        </Box>
      )}

      {showFilters && (
        <Stack direction="row" spacing={1} sx={{ p: 2, pb: 0 }} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            placeholder="Suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 140, flex: 1 }}
          />
          {categories && (
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>Kategorie</InputLabel>
              <Select value={categoryFilter} label="Kategorie" onChange={(e) => setCategoryFilter(e.target.value)}>
                <MenuItem value="">Alle</MenuItem>
                {categories.map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {users && (
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>Nutzer</InputLabel>
              <Select value={assigneeFilter} label="Nutzer" onChange={(e) => setAssigneeFilter(e.target.value)}>
                <MenuItem value="">Alle</MenuItem>
                {users.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.displayName}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Erledigte</InputLabel>
            <Select value={completionMode} label="Erledigte" onChange={(e) => setCompletionMode(e.target.value as CompletionMode)}>
              <MenuItem value="hide_completed">ausblenden</MenuItem>
              <MenuItem value="show_all">alle anzeigen</MenuItem>
              <MenuItem value="hide_if_incomplete_parent">nur wenn Eltern erledigt</MenuItem>
            </Select>
          </FormControl>
          {headerActions}
        </Stack>
      )}

      <Box sx={{ p: 1, maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
        {tree.map((node, i, arr) => (
          <TaskTreeNode
            key={node.id}
            task={{ ...node, _expanded: expandedIds.has(node.id), _onToggle: () => toggleExpand(node.id) } as any}
            level={0}
            isLast={i === arr.length - 1}
            expanded={expandedIds.has(node.id)}
            onToggle={() => toggleExpand(node.id)}
            onClick={() => onTaskClick?.(node.id)}
            draggable={draggable}
            showPomodoros={showPomodoros}
            showPlannedDate={showPlannedDate}
            accentColor={accentColor}
            parentChainIsCompleted={true}
            completionMode={completionMode}
          />
        ))}
        {tree.length === 0 && (
          <Typography color="text.disabled" textAlign="center" py={4}>
            Keine Aufgaben gefunden
          </Typography>
        )}
      </Box>
    </Box>
  );
}
