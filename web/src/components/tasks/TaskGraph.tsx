import { Box, Paper, Stack, Typography, Chip, Tooltip } from "@mui/material";
import { CheckCircle as CheckCircleIcon, KeyboardArrowUp as ArrowUpIcon } from "@mui/icons-material";

export interface GraphNodeData {
  id: string;
  title: string;
  pomodoros: number | null;
  isCompleted: boolean;
  subtaskCount?: number;
}

interface GraphNodeProps {
  data: GraphNodeData;
  current?: boolean;
  dimmed?: boolean;
  onClick?: (data: GraphNodeData) => void;
}

function GraphNode({ data, current, dimmed, onClick }: GraphNodeProps) {
  return (
    <Paper
      variant="outlined"
      onClick={() => onClick?.(data)}
      sx={{
        px: 0.75,
        py: 0.5,
        cursor: onClick ? "pointer" : "default",
        maxWidth: 130,
        minWidth: 70,
        borderRadius: 1.5,
        borderColor: current ? "primary.main" : dimmed ? "action.disabledBorder" : "divider",
        borderWidth: current ? 2 : 1,
        bgcolor: current ? "primary.main" : dimmed ? "action.disabledBackground" : data.isCompleted ? "action.hover" : "background.paper",
        color: current ? "primary.contrastText" : dimmed ? "text.disabled" : undefined,
        opacity: dimmed ? 0.75 : 1,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.5}>
        {data.isCompleted && (
          <CheckCircleIcon fontSize="inherit" sx={{ color: current ? "inherit" : "success.main", flexShrink: 0 }} />
        )}
        <Typography
          variant="caption"
          noWrap
          sx={{ fontWeight: current ? 700 : dimmed ? 400 : 500, overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {data.title}
        </Typography>
        {data.pomodoros != null && data.pomodoros > 0 && (
          <Tooltip title={`${data.pomodoros} Pomodoro${data.pomodoros > 1 ? "s" : ""} ≈ ${data.pomodoros * 25} Minuten`}>
            <Chip size="small" label={data.pomodoros} sx={{ height: 18, fontSize: 10, ml: "auto", flexShrink: 0 }} />
          </Tooltip>
        )}
        {data.subtaskCount != null && data.subtaskCount > 0 && (
          <Tooltip title={`${data.subtaskCount} Unteraufgabe${data.subtaskCount > 1 ? "n" : ""}`}>
            <Chip size="small" label={`▸ ${data.subtaskCount}`} sx={{ height: 18, fontSize: 10, flexShrink: 0 }} />
          </Tooltip>
        )}
      </Stack>
    </Paper>
  );
}

interface TaskGraphProps {
  task: GraphNodeData;
  ancestors: GraphNodeData[];
  subtasks: GraphNodeData[];
  linkedTasks: GraphNodeData[];
  onNavigate: (id: string, title: string) => void;
}

export function TaskGraph({ task, ancestors, subtasks, linkedTasks, onNavigate }: TaskGraphProps) {
  const completed = subtasks.filter((s) => s.isCompleted).length;
  const nav = (d: GraphNodeData) => onNavigate(d.id, d.title);
  const directParent = ancestors[ancestors.length - 1] ?? null;
  const grandparent = ancestors[ancestors.length - 2] ?? null;
  const moreAncestors = ancestors.length - 2;

  const leftLinks = linkedTasks.filter((_, i) => i % 2 === 0);
  const rightLinks = linkedTasks.filter((_, i) => i % 2 === 1);

  return (
    <Paper variant="outlined" sx={{ p: 2, maxHeight: 400, overflowY: "auto" }}>
      {grandparent && (
        <>
          <Stack alignItems="center" spacing={0.5} mb={0.5}>
            <Tooltip title="Weitere übergeordnete Ebenen">
              <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <ArrowUpIcon fontSize="inherit" />
                {moreAncestors > 1 ? `${moreAncestors} Ebenen darüber` : "Übergeordnet"}
              </Typography>
            </Tooltip>
            <GraphNode data={grandparent} dimmed onClick={nav} />
          </Stack>
          <Box sx={{ width: 2, height: 10, bgcolor: "divider", mx: "auto" }} />
        </>
      )}
      {directParent && (
        <>
          <Stack alignItems="center" spacing={0.5} mb={0.5}>
            <Typography variant="caption" color="text.secondary">Übergeordnet</Typography>
            <GraphNode data={directParent} onClick={nav} />
          </Stack>
          <Box sx={{ width: 2, height: 12, bgcolor: "divider", mx: "auto" }} />
        </>
      )}

      <Stack direction="row" justifyContent="center" alignItems="center" spacing={1} flexWrap="wrap">
        {leftLinks.map((lt) => <GraphNode key={lt.id} data={lt} onClick={nav} />)}
        <GraphNode data={task} current onClick={nav} />
        {rightLinks.map((lt) => <GraphNode key={lt.id} data={lt} onClick={nav} />)}
      </Stack>

      {subtasks.length > 0 && (
        <>
          <Box sx={{ width: 2, height: 12, bgcolor: "divider", mx: "auto", mt: 0.5 }} />
          <Typography variant="caption" color="text.secondary" textAlign="center" display="block">
            Unteraufgaben ({completed}/{subtasks.length})
          </Typography>
          <Stack direction="row" flexWrap="wrap" justifyContent="center" spacing={0.5} mt={0.5}>
            {subtasks.map((st) => <GraphNode key={st.id} data={st} onClick={nav} />)}
          </Stack>
        </>
      )}
    </Paper>
  );
}
