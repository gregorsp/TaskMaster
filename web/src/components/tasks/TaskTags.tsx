import { Box, Chip, Tooltip } from "@mui/material";
import { Lock as LockIcon } from "@mui/icons-material";
import type { TaskAssignee } from "../../api/tasksApi";
import { AssigneeAvatars } from "./AssigneeAvatars";

interface TaskTagsProps {
  important?: boolean;
  urgent?: boolean;
  overdue?: boolean;
  habit?: boolean;
  isPrivate?: boolean;
  categoryColor?: string;
  categoryName?: string;
  pomodoros?: number | null;
  assignees?: TaskAssignee[];
}

export function TaskTags({
  important, urgent, overdue, habit, isPrivate, categoryColor, categoryName, pomodoros, assignees,
}: TaskTagsProps) {
  return (
    <>
      {habit && <Chip size="small" label="Habit" color="success" variant="outlined" sx={{ height: 18, fontSize: 10 }} />}
      {categoryColor && (
        <Tooltip title={categoryName || ""}>
          <Box component="span" sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: categoryColor, flexShrink: 0 }} />
        </Tooltip>
      )}
      {important && (
        <Box component="span" sx={{ fontSize: 11, color: "warning.main", flexShrink: 0, fontWeight: 600 }} title="Wichtig">W</Box>
      )}
      {urgent && (
        <Box component="span" sx={{ fontSize: 11, color: "error.main", flexShrink: 0, fontWeight: 600 }} title="Dringend">D</Box>
      )}
      {overdue && (
        <Box component="span" sx={{ fontSize: 11, color: "error.main", flexShrink: 0, fontWeight: 700 }} title="Überfällig">!</Box>
      )}
      {pomodoros != null && pomodoros > 0 && (
        <Tooltip title={`${pomodoros} Pomodoro${pomodoros > 1 ? "s" : ""} ≈ ${pomodoros * 25} Minuten`}>
          <Box component="span" sx={{ fontSize: 11, color: "text.disabled", flexShrink: 0, ml: 0.25, fontFamily: "JetBrains Mono, monospace" }}>
            {pomodoros} Pomo
          </Box>
        </Tooltip>
      )}
      {isPrivate && <LockIcon sx={{ fontSize: 13, color: "text.disabled", flexShrink: 0, ml: 0.25 }} />}
      {assignees && assignees.length > 0 && <AssigneeAvatars assignees={assignees} size={18} max={3} />}
    </>
  );
}
