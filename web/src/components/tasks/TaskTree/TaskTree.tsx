import { useState, useMemo, useCallback, type ReactNode } from "react";
import {
  Box, Typography, Stack, Button,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { TaskTreeNode, type TaskWithMeta, type CompletionMode } from "./TaskTreeNode";

export type { CompletionMode, TaskWithMeta } from "./TaskTreeNode";

interface TaskTreeProps {
  tasks: TaskWithMeta[];
  draggable?: boolean;
  onTaskClick?: (taskId: string) => void;
  showPomodoros?: boolean;
  showPlannedDate?: boolean;
  title?: string;
  filterBar?: ReactNode;
  completionMode?: CompletionMode;
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
  tasks, draggable, onTaskClick, showPomodoros,
  showPlannedDate, title, filterBar,
  completionMode = "hide_completed",
}: TaskTreeProps) {
  const theme = useTheme();
  const accentColor = theme.palette.primary.main;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

  const tree = useMemo(() => {
    const roots = buildTree(tasks);
    const decorate = (nodes: TaskWithMeta[]) => {
      for (const n of nodes) {
        (n as any)._expanded = expandedIds.has(n.id);
        (n as any)._onToggle = () => toggleExpand(n.id);
        (n as any)._onClick = onTaskClick ? () => onTaskClick(n.id) : undefined;
        const children = (n as any)._children as TaskWithMeta[] | undefined;
        if (children) decorate(children);
      }
    };
    decorate(roots);
    return roots;
  }, [tasks, expandedIds, toggleExpand, onTaskClick]);

  const taskMap = useMemo(() => {
    const m = new Map<string, TaskWithMeta>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

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

  const totalCount = tasks.length;

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

      {filterBar && (
        <Box sx={{ px: 2, pt: 1.5 }}>{filterBar}</Box>
      )}

      <Box sx={{ p: 1, maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
        {tree.map((node, i, arr) => (
          <TaskTreeNode
            key={node.id}
            task={node}
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
