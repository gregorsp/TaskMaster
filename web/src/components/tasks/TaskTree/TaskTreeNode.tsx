import { useState } from "react";
import { Box, Typography } from "@mui/material";
import type { Task } from "../../../api/tasksApi";
import type { Category } from "../../../api/categoriesApi";

export interface TaskWithMeta extends Task {
  categories?: Category[];
}

interface TaskTreeNodeProps {
  task: TaskWithMeta;
  level: number;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  draggable?: boolean;
  showPomodoros?: boolean;
  showPlannedDate?: boolean;
  accentColor: string;
  parentChainIsCompleted: boolean;
  completionMode: CompletionMode;
}

export type CompletionMode = "hide_completed" | "show_all" | "hide_if_incomplete_parent";

export function collectDescendantIds(task: TaskWithMeta): string[] {
  const ids = [task.id];
  const children = (task as any)._children as TaskWithMeta[] | undefined;
  if (children) {
    for (const child of children) {
      ids.push(...collectDescendantIds(child));
    }
  }
  return ids;
}

const LINE_COLOR = "divider";
const INDENT = 20;

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
  task, level, isLast, expanded, onToggle, onClick,
  draggable, showPomodoros, showPlannedDate, accentColor, parentChainIsCompleted, completionMode,
}: TaskTreeNodeProps) {
  const hasChildren = (task as any)._children?.length > 0;
  const isCompleted = task.isCompleted;
  const shouldHide =
    completionMode === "hide_completed" ? isCompleted :
    completionMode === "hide_if_incomplete_parent" ? isCompleted && !parentChainIsCompleted :
    false;

  if (shouldHide) return null;

  const plannedWhen = showPlannedDate && task.plannedDate ? formatPlannedDate(task.plannedDate) : "";

  return (
    <Box>
      <Box
        sx={{
          display: "flex", alignItems: "center", gap: 1,
          py: 0.5, px: 1.5, cursor: "pointer", borderRadius: 1,
          position: "relative", pl: `${level * INDENT + 12}px`,
          ml: level > 0 ? 0 : undefined,
          transition: "background 120ms",
          "&:hover": { bgcolor: "action.hover" },
          textDecoration: isCompleted ? "line-through" : undefined,
          opacity: isCompleted ? 0.55 : 1,
        }}
        onClick={onClick}
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
          onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggle(); }}
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
            color: isCompleted ? "text.disabled" : level === 0 ? "text.primary" : hasChildren ? "text.secondary" : "text.secondary",
            flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            letterSpacing: level === 0 ? "-0.01em" : 0,
          }}
        >
          {task.title}
        </Typography>

        {task.isImportant && (
          <Box component="span" sx={{ fontSize: 11, color: "error.main", flexShrink: 0 }} title="Wichtig">W</Box>
        )}
        {task.isUrgent && (
          <Box component="span" sx={{ fontSize: 11, color: "warning.main", flexShrink: 0 }} title="Dringend">D</Box>
        )}
        {task.isOverdue && (
          <Box component="span" sx={{ fontSize: 11, color: "error.main", flexShrink: 0 }} title="Überfällig">!</Box>
        )}

        {showPomodoros && (
          <Typography sx={{ fontSize: 11, color: "text.disabled", flexShrink: 0, ml: 0.5, fontFamily: "JetBrains Mono, monospace" }}>
            {task.pomodoros != null ? `${task.pomodoros} Pomo` : ""}
          </Typography>
        )}

        {showPlannedDate && plannedWhen && (
          <Typography sx={{ fontSize: 11, color: task.isOverdue ? "error.main" : "text.disabled", flexShrink: 0, ml: 0.5 }}>
            {plannedWhen}
          </Typography>
        )}
      </Box>

      {hasChildren && expanded && (
        <Box>
          {(task as any)._children.map((child: TaskWithMeta, i: number, arr: TaskWithMeta[]) => (
            <TaskTreeNode
              key={child.id}
              task={child}
              level={level + 1}
              isLast={i === arr.length - 1}
              expanded={(child as any)._expanded ?? false}
              onToggle={() => { (child as any)._onToggle?.(); }}
              onClick={() => onClick?.()}
              draggable={draggable}
              showPomodoros={showPomodoros}
              showPlannedDate={showPlannedDate}
              accentColor={accentColor}
              parentChainIsCompleted={parentChainIsCompleted && isCompleted}
              completionMode={completionMode}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
