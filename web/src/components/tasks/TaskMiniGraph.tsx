import { useMemo, useCallback, useState, useEffect } from "react";
import { Box, IconButton } from "@mui/material";
import { ZoomInMap as FullscreenIcon } from "@mui/icons-material";
import { ReactFlow, Handle, Position, type Node, type Edge, useNodesState, useEdgesState, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import type { Task } from "../../api/tasksApi";
import { TaskGraphDialog } from "./TaskGraphDialog";

interface Props {
  taskId: string;
  subtasks: Task[];
  siblings: Task[];
  links: Task[];
  parentTask: Task | null;
  onNodeClick: (task: Task) => void;
}

function TaskNode({ data }: { data: { label: string; onClick: () => void; isCenter?: boolean; isCompleted?: boolean } }) {
  const done = data.isCompleted && !data.isCenter;
  return (
    <Box
      sx={{
        px: 1.5,
        py: 0.5,
        borderRadius: 1,
        bgcolor: data.isCenter ? "primary.main" : done ? "success.main" : "secondary.main",
        color: "white",
        fontSize: 11,
        fontWeight: data.isCenter ? 700 : 500,
        cursor: "pointer",
        maxWidth: 160,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        textDecoration: done ? "line-through" : "none",
        opacity: done ? 0.8 : 1,
        border: data.isCenter ? "1.5px solid" : "none",
        borderColor: "primary.dark",
        "&:hover": { opacity: 0.85 },
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "transparent", border: "none" }} />
      {done && "✓ "}{data.label}
      <Handle type="source" position={Position.Bottom} style={{ background: "transparent", border: "none" }} />
    </Box>
  );
}

const nodeTypes = { taskNode: TaskNode };

function layoutGraph(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 36, marginx: 8, marginy: 8 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 150, height: 28 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const positioned = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 75, y: pos.y - 14 },
    };
  });

  const center = positioned.find(
    (n) => !n.id.startsWith("parent-") && !n.id.startsWith("child-") && !n.id.startsWith("sib-") && !n.id.startsWith("link-")
  );
  if (!center) return positioned;

  const stepX = 150 + 24;
  positioned
    .filter((n) => n.id.startsWith("sib-"))
    .forEach((n, i) => {
      n.position = { x: center.position.x - stepX * (i + 1), y: center.position.y };
    });
  positioned
    .filter((n) => n.id.startsWith("link-"))
    .forEach((n, i) => {
      n.position = { x: center.position.x + stepX * (i + 1), y: center.position.y };
    });
  positioned
    .filter((n) => n.id.startsWith("parent-"))
    .forEach((n) => {
      n.position = { ...n.position, x: center.position.x };
    });
  positioned
    .filter((n) => n.id.startsWith("child-"))
    .forEach((n, i) => {
      n.position = { ...n.position, x: center.position.x + stepX * (i - (positioned.filter((c) => c.id.startsWith("child-")).length - 1) / 2) };
    });

  return positioned;
}

export function TaskMiniGraph({ taskId, subtasks, siblings, links, parentTask, onNodeClick }: Props) {
  const [graphOpen, setGraphOpen] = useState(false);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    nodes.push({
      id: taskId,
      type: "taskNode",
      position: { x: 0, y: 0 },
      data: { label: "(diese)", onClick: () => {}, isCenter: true },
      draggable: false,
    });

    if (parentTask) {
      nodes.push({
        id: `parent-${parentTask.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: parentTask.title, onClick: () => onNodeClick(parentTask), isCompleted: parentTask.isCompleted },
        draggable: false,
      });
      edges.push({
        id: "parent-edge",
        source: `parent-${parentTask.id}`,
        target: taskId,
        style: { stroke: "#1976d2", strokeWidth: 1.5 },
      });
    }

    subtasks.forEach((st) => {
      nodes.push({
        id: `child-${st.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: st.title, onClick: () => onNodeClick(st), isCompleted: st.isCompleted },
        draggable: false,
      });
      edges.push({
        id: `child-edge-${st.id}`,
        source: taskId,
        target: `child-${st.id}`,
        style: { stroke: "#1976d2", strokeWidth: 1 },
      });
    });

    siblings.forEach((s) => {
      nodes.push({
        id: `sib-${s.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: s.title, onClick: () => onNodeClick(s), isCompleted: s.isCompleted },
        draggable: false,
      });
      edges.push({
        id: `sib-edge-${s.id}`,
        source: `sib-${s.id}`,
        target: taskId,
        style: { stroke: "#ed6c02", strokeWidth: 1, strokeDasharray: "5 3" },
      });
    });

    links.forEach((l) => {
      nodes.push({
        id: `link-${l.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: l.title, onClick: () => onNodeClick(l), isCompleted: l.isCompleted },
        draggable: false,
        style: { background: "#9c27b0" },
      });
      edges.push({
        id: `link-edge-${l.id}`,
        source: `link-${l.id}`,
        target: taskId,
        style: { stroke: "#9c27b0", strokeWidth: 1, strokeDasharray: "3 2" },
      });
    });

    if (nodes.length > 1) {
      return { nodes: layoutGraph(nodes, edges), edges };
    }
    return { nodes, edges };
  }, [taskId, subtasks, siblings, links, parentTask, onNodeClick]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    if (rfInstance && initialNodes.length > 1) {
      let cancelled = false;
      const t1 = requestAnimationFrame(() => {
        const t2 = requestAnimationFrame(() => {
          if (!cancelled) {
            rfInstance.fitView({ padding: 0.3, maxZoom: 1.5, duration: 200 });
          }
        });
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(t1);
      };
    }
  }, [initialNodes, rfInstance]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      (node.data as { onClick?: () => void }).onClick?.();
    },
    []
  );

  return (
    <>
      <Box sx={{ height: 200, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", position: "relative" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onInit={setRfInstance}
          nodeTypes={nodeTypes}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          panOnScroll={false}
          panOnDrag={false}
          preventScrolling={false}
          noWheelClassName="nowheel"
          fitView={initialNodes.length <= 1}
        />
        <IconButton
          size="small"
          sx={{ position: "absolute", bottom: 4, right: 4, zIndex: 10, bgcolor: "background.paper" }}
          onClick={() => setGraphOpen(true)}
        >
          <FullscreenIcon fontSize="small" />
        </IconButton>
      </Box>
      <TaskGraphDialog
        open={graphOpen}
        taskId={taskId}
        subtasks={subtasks}
        siblings={siblings}
        links={links}
        parentTask={parentTask}
        onClose={() => setGraphOpen(false)}
        onNodeClick={onNodeClick}
      />
    </>
  );
}
