import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { Link as LinkIcon } from "@mui/icons-material";
import type { TaskWithMeta, CompletionMode } from "../taskFilterModel";
import { collectDescendantIds } from "../taskFilterModel";
import { TaskTags } from "../TaskTags";

export type { TaskWithMeta, CompletionMode } from "../taskFilterModel";
export { collectDescendantIds } from "../taskFilterModel";

interface TaskTreeNodeProps {
  task: TaskWithMeta;
  level: number;
  isLast: boolean;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onClick: (task: TaskWithMeta) => void;
  onLinkClick?: (task: TaskWithMeta) => void;
  draggable?: boolean;
  showPomodoros?: boolean;
  showPlannedDate?: boolean;
  showLinkBadge?: boolean;
  accentColor: string;
  completionMode: CompletionMode;
  parentChainIsCompleted: boolean;
  renderExtra?: (task: TaskWithMeta) => ReactNode;
}

const LINE_COLOR = "divider";
const INDENT = 20;

function sumPomodoros(task: TaskWithMeta): number {
  let sum = task.pomodoros ?? 0;
  if (task._children) for (const c of task._children) sum += sumPomodoros(c);
  return sum;
}

function formatPlannedDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gestern";
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export function TaskTreeNode({
  task, level, isLast, expandedIds, onToggle, onClick, onLinkClick,
  draggable, showPomodoros, showPlannedDate, showLinkBadge, accentColor,
  completionMode, parentChainIsCompleted, renderExtra,
}: TaskTreeNodeProps) {
  const children = task._children ?? [];
  const hasChildren = children.length > 0;
  const isCompleted = task.isCompleted;
  const expanded = expandedIds.has(task.id);

  const shouldHide =
    completionMode === "hide_completed" ? isCompleted :
    completionMode === "hide_if_incomplete_parent" ? isCompleted && !parentChainIsCompleted :
    false;

  if (shouldHide) return null;

  const plannedWhen = showPlannedDate && task.plannedDate ? formatPlannedDate(task.plannedDate) : "";
  const effectivePomodoros = hasChildren ? sumPomodoros(task) : task.pomodoros;

  return (
    <Box>
      <Box
        sx={{
          display: "flex", alignItems: "center", gap: 1,
          py: 0.5, px: 1.5, cursor: "pointer", borderRadius: 1,
          position: "relative", pl: `${level * INDENT + 12}px`,
          transition: "background 120ms",
          "&:hover": { bgcolor: "action.hover" },
          textDecoration: isCompleted ? "line-through" : undefined,
          opacity: isCompleted ? 0.55 : 1,
        }}
        onClick={() => onClick(task)}
        draggable={draggable}
        onDragStart={(e) => {
          if (!draggable) return;
          const ids = collectDescendantIds(task);
          e.dataTransfer.setData("text/task-ids", JSON.stringify(ids));
          e.dataTransfer.setData("text/task-id", task.id);
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        {Array.from({ length: level }).map((_, i) => (
          <Box
            key={i}
            sx={{
              position: "absolute",
              left: `${i * INDENT + 13}px`,
              top: 0, bottom: 0, width: 1,
              bgcolor: LINE_COLOR,
              opacity: level > 0 ? 1 : 0,
            }}
          />
        ))}

        <Box
          sx={{
            width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, color: hasChildren ? accentColor : "text.disabled", zIndex: 1,
          }}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(task.id); }}
        >
          {hasChildren ? (
            <Box component="span" sx={{ fontSize: 12, transition: "transform 180ms", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>
              ▶
            </Box>
          ) : (
            <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: "currentColor", opacity: 0.5 }} />
          )}
        </Box>

        <Typography
          sx={{
            fontFamily: "Inter, sans-serif",
            fontSize: 13,
            fontWeight: level === 0 && hasChildren ? 600 : 400,
            color: isCompleted ? "text.disabled" : "text.primary",
            flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            letterSpacing: level === 0 ? "-0.01em" : 0,
          }}
        >
          {task.title}
        </Typography>

        <TaskTags
          important={task.isImportant}
          urgent={task.isUrgent}
          overdue={task.isOverdue}
          habit={task.isHabit}
          isPrivate={task.isPrivate}
          categoryColor={task.categories?.[0]?.color}
          categoryName={task.categories?.[0]?.name}
          pomodoros={showPomodoros ? effectivePomodoros : undefined}
          assignees={task.assignees}
        />

        {showLinkBadge && (task.linkCount ?? 0) > 0 && (
          <Box
            component="span"
            onClick={(e) => { e.stopPropagation(); onLinkClick?.(task); }}
            title="Verknüpfungen öffnen"
            sx={{
              display: "inline-flex", alignItems: "center", gap: 0.25,
              fontSize: 11, color: "secondary.main", flexShrink: 0,
              cursor: "pointer", px: 0.5, py: 0.25, borderRadius: 1,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <LinkIcon sx={{ fontSize: 12 }} />{task.linkCount}
          </Box>
        )}

        {renderExtra?.(task)}

        {showPlannedDate && plannedWhen && (
          <Typography sx={{ fontSize: 11, color: task.isOverdue ? "error.main" : "text.disabled", flexShrink: 0, ml: 0.5 }}>
            {plannedWhen}
          </Typography>
        )}
      </Box>

      {hasChildren && expanded && (
        <Box>
          {children.map((child, i) => (
            <TaskTreeNode
              key={child.id}
              task={child}
              level={level + 1}
              isLast={i === children.length - 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onClick={onClick}
              onLinkClick={onLinkClick}
              draggable={draggable}
              showPomodoros={showPomodoros}
              showPlannedDate={showPlannedDate}
              showLinkBadge={showLinkBadge}
              accentColor={accentColor}
              completionMode={completionMode}
              parentChainIsCompleted={parentChainIsCompleted && isCompleted}
              renderExtra={renderExtra}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
