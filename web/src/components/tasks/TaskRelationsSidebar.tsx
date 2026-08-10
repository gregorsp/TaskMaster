import { useState, useEffect } from "react";
import { Box, Typography, Stack, Chip, IconButton, LinearProgress, Paper, Tooltip } from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { getSubtasks, getSiblings, getTaskLinks, type Task, type SubtaskResponse } from "../../api/tasksApi";
import { TaskMiniGraph } from "./TaskMiniGraph";
import { LinkTaskDialog } from "./LinkTaskDialog";

interface Props {
  taskId: string;
  parentTask: Task | null;
  onRefresh: () => void;
  onNavigateToTask: (task: Task) => void;
}

export function TaskRelationsSidebar({ taskId, parentTask, onRefresh, onNavigateToTask }: Props) {
  const [subtaskData, setSubtaskData] = useState<SubtaskResponse | null>(null);
  const [siblings, setSiblings] = useState<Task[]>([]);
  const [links, setLinks] = useState<Task[]>([]);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  useEffect(() => {
    loadRelations();
  }, [taskId]);

  const loadRelations = () => {
    getSubtasks(taskId).then(setSubtaskData).catch(() => {});
    getSiblings(taskId).then(setSiblings).catch(() => {});
    getTaskLinks(taskId).then(setLinks).catch(() => {});
  };

  const progress = subtaskData?.progress;
  const progressPct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <Box sx={{ width: 280, borderRight: 1, borderColor: "divider", p: 2, display: "flex", flexDirection: "column", gap: 2, maxHeight: "70vh", overflowY: "auto" }}>
      {parentTask && (
        <Box>
          <Typography variant="caption" color="text.secondary" mb={0.5}>Übergeordnet</Typography>
          <Chip
            label={parentTask.title}
            size="small"
            color="primary"
            variant="outlined"
            onClick={() => onNavigateToTask(parentTask)}
            sx={{ maxWidth: "100%", cursor: "pointer" }}
          />
        </Box>
      )}

      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
          <Typography variant="caption" color="text.secondary">
            Unteraufgaben {progress && `(${progress.completed}/${progress.total})`}
          </Typography>
          <IconButton size="small" onClick={onRefresh}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Stack>
        {progress && progress.total > 0 && (
          <Tooltip title={`${progressPct}% erledigt`}>
            <LinearProgress
              variant="determinate"
              value={progressPct}
              sx={{ mb: 1, height: 6, borderRadius: 3 }}
            />
          </Tooltip>
        )}
        {subtaskData?.subtasks.map((st) => (
          <Paper
            key={st.id}
            variant="outlined"
            sx={{
              p: 1,
              mb: 0.5,
              cursor: "pointer",
              opacity: st.isCompleted ? 0.6 : 1,
              "&:hover": { bgcolor: "action.hover" },
            }}
            onClick={() => onNavigateToTask(st)}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="body2" sx={{ textDecoration: st.isCompleted ? "line-through" : "none", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {st.isCompleted ? "✓ " : ""}{st.title}
              </Typography>
              {st.pomodoros != null && st.pomodoros > 0 && (
                <Chip label={`${st.pomodoros} SP`} size="small" variant="outlined" sx={{ ml: 0.5, height: 20, fontSize: 11 }} />
              )}
            </Stack>
          </Paper>
        ))}
        {(!subtaskData?.subtasks || subtaskData.subtasks.length === 0) && (
          <Typography variant="caption" color="text.secondary">Keine Unteraufgaben.</Typography>
        )}
      </Box>

      {siblings.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" mb={0.5}>Geschwister</Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.5}>
            {siblings.map((s) => (
              <Chip key={s.id} label={s.title} size="small" variant="outlined" onClick={() => onNavigateToTask(s)} sx={{ cursor: "pointer", maxWidth: "100%" }} />
            ))}
          </Stack>
        </Box>
      )}

      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
          <Typography variant="caption" color="text.secondary">Verknüpft</Typography>
          <IconButton size="small" onClick={() => setLinkDialogOpen(true)}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Stack direction="row" flexWrap="wrap" gap={0.5}>
          {links.map((l) => (
              <Chip key={l.id} label={l.title} size="small" variant="outlined" onClick={() => onNavigateToTask(l)} color="secondary" sx={{ cursor: "pointer", maxWidth: "100%" }} />
          ))}
          {links.length === 0 && (
            <Typography variant="caption" color="text.secondary">Keine Verknüpfungen.</Typography>
          )}
        </Stack>
      </Box>

      <Box sx={{ mt: "auto" }}>
        <Typography variant="caption" color="text.secondary" mb={0.5}>Abhängigkeitsgraph</Typography>
        <TaskMiniGraph
          taskId={taskId}
          subtasks={subtaskData?.subtasks || []}
          siblings={siblings}
          links={links}
          parentTask={parentTask}
          onNodeClick={onNavigateToTask}
        />
      </Box>

      <LinkTaskDialog open={linkDialogOpen} taskId={taskId} onClose={() => { setLinkDialogOpen(false); loadRelations(); }} />
    </Box>
  );
}
