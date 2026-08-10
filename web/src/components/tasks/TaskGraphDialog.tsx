import { useMemo, useCallback } from "react";
import { Dialog, DialogTitle, DialogContent, Box, Typography, Stack } from "@mui/material";
import { ReactFlow, Handle, Position, type Node, type Edge, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import type { Task } from "../../api/tasksApi";

interface Props {
  open: boolean;
  taskId: string;
  subtasks: Task[];
  siblings: Task[];
  links: Task[];
  parentTask: Task | null;
  onClose: () => void;
  onNodeClick: (task: Task) => void;
}

function TaskNode({ data }: { data: { label: string; onClick: () => void; isCenter?: boolean } }) {
  return (
    <Box
      onClick={data.onClick}
      sx={{
        px: 2,
        py: 1,
        borderRadius: 1.5,
        bgcolor: data.isCenter ? "primary.main" : "secondary.main",
        color: "white",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        maxWidth: 250,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        border: data.isCenter ? "2px solid" : "none",
        borderColor: "primary.dark",
        "&:hover": { opacity: 0.85 },
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "transparent" }} />
      {data.isCenter && "📍 "}{data.label}
      <Handle type="source" position={Position.Bottom} style={{ background: "transparent" }} />
    </Box>
  );
}

const nodeTypes = { taskNode: TaskNode };

function layoutGraph(nodes: Node[], edges: Edge[], centerId: string) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 100 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 200, height: 40 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 100, y: pos.y - 20 },
    };
  });
}

export function TaskGraphDialog({ open, taskId, subtasks, siblings, links, parentTask, onClose, onNodeClick }: Props) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    nodes.push({
      id: taskId,
      type: "taskNode",
      position: { x: 0, y: 0 },
      data: { label: "(aktuelle Aufgabe)", onClick: () => {}, isCenter: true },
    });

    if (parentTask) {
      nodes.push({
        id: `parent-${parentTask.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: parentTask.title, onClick: () => onNodeClick(parentTask) },
      });
      edges.push({ id: "parent-edge", source: `parent-${parentTask.id}`, target: taskId, type: "smoothstep", style: { stroke: "#1976d2", strokeWidth: 2 } });
    }

    subtasks.forEach((st) => {
      nodes.push({
        id: `child-${st.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: st.isCompleted ? `✓ ${st.title}` : st.title, onClick: () => onNodeClick(st) },
      });
      edges.push({ id: `child-edge-${st.id}`, source: taskId, target: `child-${st.id}`, type: "smoothstep", style: { stroke: "#1976d2", strokeWidth: 1.5 } });
    });

    siblings.forEach((s) => {
      nodes.push({
        id: `sib-${s.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: s.title, onClick: () => onNodeClick(s) },
      });
      edges.push({ id: `sib-edge-${s.id}`, source: `sib-${s.id}`, target: taskId, type: "smoothstep", style: { stroke: "#ed6c02", strokeWidth: 1, strokeDasharray: "8 4" } });
    });

    links.forEach((l) => {
      nodes.push({
        id: `link-${l.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: l.title, onClick: () => onNodeClick(l) },
        style: { background: "#9c27b0" },
      });
      edges.push({ id: `link-edge-${l.id}`, source: `link-${l.id}`, target: taskId, type: "smoothstep", style: { stroke: "#9c27b0", strokeWidth: 1, strokeDasharray: "4 2" } });
    });

    const layouted = layoutGraph(nodes, edges, taskId);
    return { nodes: layouted, edges };
  }, [taskId, subtasks, siblings, links, parentTask, onNodeClick]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      (node.data as { onClick?: () => void }).onClick?.();
    },
    []
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Abhängigkeitsgraph</DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Stack spacing={0.5} direction="row" px={2} pt={1} pb={0.5} fontSize={11} color="text.secondary" flexWrap="wrap">
          <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ width: 20, height: 2, bgcolor: "#1976d2" }} /> Parent/Child
          </Typography>
          <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ width: 20, height: 2, borderBottom: "2px dashed", borderColor: "#ed6c02" }} /> Geschwister
          </Typography>
          <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ width: 20, height: 2, borderBottom: "2px dotted", borderColor: "#9c27b0" }} /> Verknüpft
          </Typography>
        </Stack>
        <Box sx={{ height: 500 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            fitView
          />
        </Box>
      </DialogContent>
    </Dialog>
  );
}
