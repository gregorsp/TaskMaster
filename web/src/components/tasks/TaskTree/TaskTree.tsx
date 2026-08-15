import { useState, useMemo, useCallback, type ReactNode } from "react";
import { Box, Typography, Stack, Button } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { TaskTreeNode, type TaskWithMeta, type CompletionMode } from "./TaskTreeNode";
import { buildTaskTree, type SortKey, type SortOrder } from "../taskFilterModel";

export type { TaskWithMeta, CompletionMode } from "./TaskTreeNode";
export { collectDescendantIds } from "./TaskTreeNode";

interface TaskTreeProps {
  tasks: TaskWithMeta[];
  draggable?: boolean;
  onTaskClick?: (task: TaskWithMeta) => void;
  onLinkClick?: (task: TaskWithMeta) => void;
  showPomodoros?: boolean;
  showPlannedDate?: boolean;
  showLinkBadge?: boolean;
  title?: string;
  sort?: SortKey;
  order?: SortOrder;
  completionMode?: CompletionMode;
  expandStorageKey?: string;
  renderExtra?: (task: TaskWithMeta) => ReactNode;
}

export function TaskTree({
  tasks, draggable, onTaskClick, onLinkClick, showPomodoros, showPlannedDate,
  showLinkBadge, title, sort = "createdAt", order = "desc",
  completionMode = "hide_completed", expandStorageKey, renderExtra,
}: TaskTreeProps) {
  const theme = useTheme();
  const accentColor = theme.palette.primary.main;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    if (expandStorageKey) {
      try {
        const raw = localStorage.getItem(expandStorageKey);
        if (raw) return new Set(JSON.parse(raw) as string[]);
      } catch {
        /* ignore */
      }
    }
    return new Set();
  });

  const persistExpanded = useCallback(
    (next: Set<string>) => {
      if (!expandStorageKey) return;
      try {
        localStorage.setItem(expandStorageKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
    },
    [expandStorageKey]
  );

  const toggleExpand = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded]
  );

  const tree = useMemo(() => buildTaskTree(tasks, sort, order), [tasks, sort, order]);

  const allExpandable = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) if (tasks.some((c) => c.parentId === t.id)) ids.add(t.id);
    return ids;
  }, [tasks]);

  const expandAll = useCallback(() => {
    setExpandedIds(allExpandable);
    persistExpanded(allExpandable);
  }, [allExpandable, persistExpanded]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
    persistExpanded(new Set());
  }, [persistExpanded]);

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper", overflow: "hidden" }}>
      <Box sx={{ px: 2, pt: 2, pb: 0 }}>
        {title && <Typography variant="h6" fontWeight={600}>{title}</Typography>}
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: title ? 0.5 : 0 }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
            {tasks.length} Einträge gesamt
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

      <Box sx={{ p: 1, maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
        {tree.map((node, i, arr) => (
          <TaskTreeNode
            key={node.id}
            task={node}
            level={0}
            isLast={i === arr.length - 1}
            expandedIds={expandedIds}
            onToggle={toggleExpand}
            onClick={(t) => onTaskClick?.(t)}
            onLinkClick={onLinkClick}
            draggable={draggable}
            showPomodoros={showPomodoros}
            showPlannedDate={showPlannedDate}
            showLinkBadge={showLinkBadge}
            accentColor={accentColor}
            completionMode={completionMode}
            parentChainIsCompleted={true}
            renderExtra={renderExtra}
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
