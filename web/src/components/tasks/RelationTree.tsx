import { useState } from "react";
import { Box, Collapse, IconButton, Stack, Typography, Chip, Tooltip } from "@mui/material";
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  Link as LinkIcon,
} from "@mui/icons-material";
import type { RelationNode } from "../../api/tasksApi";

interface Props {
  nodes: RelationNode[];
  childrenMap: Map<string, RelationNode[]>;
  linksByTask: Map<string, RelationNode[]>;
  currentId?: string | null;
  onNavigate: (id: string, title: string) => void;
}

function RelationNodeItem({
  node,
  childrenMap,
  linksByTask,
  currentId,
  onNavigate,
}: {
  node: RelationNode;
  childrenMap: Map<string, RelationNode[]>;
  linksByTask: Map<string, RelationNode[]>;
  currentId?: string | null;
  onNavigate: (id: string, title: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = childrenMap.get(node.id) ?? [];
  const links = linksByTask.get(node.id) ?? [];
  const hasChildren = children.length > 0;
  const isCurrent = node.id === currentId;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ py: 0.25 }}>
        <Box sx={{ width: 28, flexShrink: 0, display: "flex", justifyContent: "center" }}>
          {hasChildren ? (
            <IconButton size="small" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          ) : null}
        </Box>
        {node.isCompleted ? (
          <CheckCircleIcon fontSize="small" color="success" sx={{ flexShrink: 0 }} />
        ) : (
          <RadioButtonUncheckedIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
        )}
        <Typography
          variant="body2"
          onClick={() => onNavigate(node.id, node.title)}
          sx={{
            cursor: "pointer",
            textDecoration: node.isCompleted ? "line-through" : undefined,
            color: node.isCompleted ? "text.disabled" : isCurrent ? "primary.main" : "text.primary",
            fontWeight: isCurrent ? 700 : undefined,
            overflowWrap: "anywhere",
            "&:hover": { textDecoration: "underline" },
          }}
        >
          {node.title}
        </Typography>
        {node.pomodoros != null && node.pomodoros > 0 && (
          <Tooltip title={`${node.pomodoros} Pomodoro${node.pomodoros > 1 ? "s" : ""} ≈ ${node.pomodoros * 25} Minuten`}>
            <Chip size="small" label={node.pomodoros} sx={{ height: 18, fontSize: 10, flexShrink: 0 }} />
          </Tooltip>
        )}
        {isCurrent && <Chip size="small" label="aktuell" color="primary" sx={{ height: 18, fontSize: 10, flexShrink: 0 }} />}
      </Stack>
      {links.length > 0 && (
        <Stack direction="row" alignItems="center" spacing={0.5} flexWrap="wrap" sx={{ pl: 4, py: 0.25 }}>
          <LinkIcon fontSize="small" color="primary" sx={{ flexShrink: 0 }} />
          {links.map((lt) => (
            <Chip
              key={lt.id}
              size="small"
              label={lt.title}
              variant="outlined"
              color={lt.isCompleted ? "success" : "default"}
              onClick={() => onNavigate(lt.id, lt.title)}
              sx={{ fontSize: 11 }}
            />
          ))}
        </Stack>
      )}
      {hasChildren && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box sx={{ pl: 3 }}>
            {children.map((child) => (
              <RelationNodeItem
                key={child.id}
                node={child}
                childrenMap={childrenMap}
                linksByTask={linksByTask}
                currentId={currentId}
                onNavigate={onNavigate}
              />
            ))}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

export function RelationTree({ nodes, childrenMap, linksByTask, currentId, onNavigate }: Props) {
  return (
    <Box>
      {nodes.map((node) => (
        <RelationNodeItem
          key={node.id}
          node={node}
          childrenMap={childrenMap}
          linksByTask={linksByTask}
          currentId={currentId}
          onNavigate={onNavigate}
        />
      ))}
    </Box>
  );
}
