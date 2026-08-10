import { useState } from "react";
import { Box, Checkbox, IconButton, Stack, Typography, Chip, Tooltip, Collapse, CircularProgress } from "@mui/material";
import { ExpandMore as ExpandMoreIcon, ChevronRight as ChevronRightIcon } from "@mui/icons-material";
import { completeTask, reopenTask, getSubtasks, type Subtask } from "../../api/tasksApi";

interface SubtaskNodeProps {
  subtask: Subtask;
  onNavigate: (id: string, title: string) => void;
  onChange: () => void;
}

function SubtaskNode({ subtask, onNavigate, onChange }: SubtaskNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Subtask[] | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const hasChildren = subtask.subtaskCount > 0;

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && children === null) {
      setLoadingChildren(true);
      try {
        const res = await getSubtasks(subtask.id);
        setChildren(res.subtasks);
      } catch (e) {
        console.error("Subtask children load error:", e);
      } finally {
        setLoadingChildren(false);
      }
    }
  };

  const handleToggle = async () => {
    try {
      if (subtask.isCompleted) await reopenTask(subtask.id);
      else await completeTask(subtask.id);
      onChange();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 0.5, py: 0.25 }}>
        <Box sx={{ width: 28, flexShrink: 0, display: "flex", justifyContent: "center" }}>
          {hasChildren ? (
            <IconButton size="small" onClick={toggle}>
              {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          ) : null}
        </Box>
        <Checkbox size="small" checked={subtask.isCompleted} onClick={handleToggle} />
        <Typography
          variant="body2"
          onClick={() => onNavigate(subtask.id, subtask.title)}
          sx={{ flex: 1, minWidth: 0, cursor: "pointer", textDecoration: subtask.isCompleted ? "line-through" : undefined, overflowWrap: "anywhere" }}
        >
          {subtask.title}
        </Typography>
        {subtask.pomodoros != null && subtask.pomodoros > 0 && (
          <Tooltip title={`${subtask.pomodoros} Pomodoro${subtask.pomodoros > 1 ? "s" : ""} ≈ ${subtask.pomodoros * 25} Minuten`}>
            <Chip size="small" label={`${subtask.pomodoros} Pomo`} variant="outlined" />
          </Tooltip>
        )}
        {hasChildren && (
          <Chip size="small" label={`${subtask.subtaskCount}`} variant="outlined" sx={{ flexShrink: 0, minWidth: 28 }} />
        )}
      </Stack>
      {hasChildren && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box sx={{ pl: 3 }}>
            {loadingChildren && <CircularProgress size={16} sx={{ ml: 3, my: 0.5 }} />}
            {!loadingChildren && children?.map((c) => (
              <SubtaskNode key={c.id} subtask={c} onNavigate={onNavigate} onChange={onChange} />
            ))}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

interface SubtaskListProps {
  subtasks: Subtask[];
  onNavigate: (id: string, title: string) => void;
  onChange: () => void;
}

export function SubtaskList({ subtasks, onNavigate, onChange }: SubtaskListProps) {
  return (
    <Box>
      {subtasks.map((st, idx) => (
        <Box key={st.id} sx={{ borderBottom: idx < subtasks.length - 1 ? "1px solid" : "none", borderColor: "divider" }}>
          <SubtaskNode subtask={st} onNavigate={onNavigate} onChange={onChange} />
        </Box>
      ))}
    </Box>
  );
}
