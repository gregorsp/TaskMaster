import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogTitle, DialogContent, Box, Typography, Stack } from "@mui/material";
import { ReactFlow, Handle, Position, type Node, type Edge, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { getTaskLinks, getSubtasks, getTask, type Task } from "../../api/tasksApi";

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

function TaskNode({ data }: { data: { label: string; onClick: () => void; isCenter?: boolean; isCompleted?: boolean } }) {
  const done = data.isCompleted && !data.isCenter;
  return (
    <Box
      sx={{
        px: 2,
        py: 1,
        borderRadius: 1.5,
        bgcolor: data.isCenter ? "primary.main" : done ? "success.main" : "secondary.main",
        color: "white",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        maxWidth: 250,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        textDecoration: done ? "line-through" : "none",
        opacity: done ? 0.8 : 1,
        border: data.isCenter ? "2px solid" : "none",
        borderColor: "primary.dark",
        "&:hover": { opacity: 0.85 },
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "transparent" }} />
      {done && "✓ "}{data.isCenter && "📍 "}{data.label}
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

  const positioned = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - 100, y: pos.y - 20 },
    };
  });

  const center = positioned.find((n) => n.id === centerId);
  if (!center) return positioned;

  const stepX = 200 + 80;
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

  const childNodes = positioned.filter((n) => n.id.startsWith("child-"));
  const clinkNodes = positioned.filter((n) => n.id.startsWith("clink-"));
  clinkNodes.forEach((n) => {
    const targetChildId = edges.find((e) => e.source === n.id)?.target;
    const childNode = childNodes.find((c) => c.id === targetChildId);
    if (!childNode) return;
    const siblingsOfChild = clinkNodes.filter((m) => edges.find((e) => e.source === m.id)?.target === targetChildId);
    const idx = siblingsOfChild.indexOf(n);
    n.position = {
      x: childNode.position.x - 220 * (idx + 1),
      y: childNode.position.y,
    };
  });

  positioned
    .filter((n) => n.id.startsWith("lparent-"))
    .forEach((n) => {
      const parentEdge = edges.find((e) => e.source === n.id);
      if (!parentEdge) return;
      const linkNode = positioned.find((l) => l.id === parentEdge.target);
      if (linkNode) n.position = { x: linkNode.position.x, y: linkNode.position.y - 100 };
    });

  positioned
    .filter((n) => n.id.startsWith("lchild-"))
    .forEach((n) => {
      const childEdge = edges.find((e) => e.target === n.id);
      if (!childEdge) return;
      const linkId = childEdge.source;
      const linkNode = positioned.find((l) => l.id === linkId);
      if (!linkNode) return;
      const linkSiblings = positioned.filter((m) => {
        const edge = edges.find((e) => e.target === m.id);
        return edge && edge.source === linkId && m.id.startsWith("lchild-");
      });
      const idx = linkSiblings.indexOf(n);
      n.position = {
        x: linkNode.position.x + 220 * (idx - (linkSiblings.length - 1) / 2),
        y: linkNode.position.y + 100,
      };
    });

  return positioned;
}

export function TaskGraphDialog({ open, taskId, subtasks, siblings, links, parentTask, onClose, onNodeClick }: Props) {
  const onNodeClickRef = useRef(onNodeClick);
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  const [childLinks, setChildLinks] = useState<Record<string, Task[]>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChildLinks({});
    Promise.all(subtasks.map((st) => getTaskLinks(st.id).catch(() => [])))
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, Task[]> = {};
        subtasks.forEach((st, i) => {
          map[st.id] = results[i];
        });
        setChildLinks(map);
      });
    return () => {
      cancelled = true;
    };
  }, [open, taskId, subtasks]);

  const [linkFamilies, setLinkFamilies] = useState<Record<string, { parent: Task | null; children: Task[] }>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLinkFamilies({});
    Promise.all(
      links.map((link) =>
        Promise.all([
          link.parentId
            ? getTask(link.parentId).catch(() => null)
            : Promise.resolve(null),
          getSubtasks(link.id).catch(() => null),
        ])
      )
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, { parent: Task | null; children: Task[] }> = {};
      links.forEach((link, i) => {
        map[link.id] = {
          parent: (results[i][0] as Task) || null,
          children: (results[i][1] as { subtasks?: Task[] })?.subtasks || [],
        };
      });
      setLinkFamilies(map);
    });
    return () => {
      cancelled = true;
    };
  }, [open, taskId, links]);

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
        data: { label: parentTask.title, onClick: () => onNodeClickRef.current(parentTask), isCompleted: parentTask.isCompleted },
      });
      edges.push({ id: "parent-edge", source: `parent-${parentTask.id}`, target: taskId, type: "smoothstep", style: { stroke: "#1976d2", strokeWidth: 2 } });
    }

    subtasks.forEach((st) => {
      nodes.push({
        id: `child-${st.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: st.title, onClick: () => onNodeClickRef.current(st), isCompleted: st.isCompleted },
      });
      edges.push({ id: `child-edge-${st.id}`, source: taskId, target: `child-${st.id}`, type: "smoothstep", style: { stroke: "#1976d2", strokeWidth: 1.5 } });
    });

    siblings.forEach((s) => {
      nodes.push({
        id: `sib-${s.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: s.title, onClick: () => onNodeClickRef.current(s), isCompleted: s.isCompleted },
      });
      edges.push({ id: `sib-edge-${s.id}`, source: `sib-${s.id}`, target: taskId, type: "smoothstep", style: { stroke: "#ed6c02", strokeWidth: 1, strokeDasharray: "8 4" } });
    });

    links.forEach((l) => {
      nodes.push({
        id: `link-${l.id}`,
        type: "taskNode",
        position: { x: 0, y: 0 },
        data: { label: l.title, onClick: () => onNodeClickRef.current(l), isCompleted: l.isCompleted },
        style: { background: "#9c27b0" },
      });
      edges.push({ id: `link-edge-${l.id}`, source: `link-${l.id}`, target: taskId, type: "smoothstep", style: { stroke: "#9c27b0", strokeWidth: 1, strokeDasharray: "4 2" } });

      const family = linkFamilies[l.id];
      if (family?.parent && family.parent.id !== taskId) {
        nodes.push({
          id: `lparent-${l.id}`,
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: { label: family.parent.title, onClick: () => onNodeClickRef.current(family.parent!), isCompleted: family.parent.isCompleted },
        });
        edges.push({
          id: `lparent-edge-${l.id}`,
          source: `lparent-${l.id}`,
          target: `link-${l.id}`,
          type: "smoothstep",
          style: { stroke: "#1976d2", strokeWidth: 1.5 },
        });
      }
      if (family?.children) {
        family.children.forEach((child) => {
          nodes.push({
            id: `lchild-${l.id}-${child.id}`,
            type: "taskNode",
            position: { x: 0, y: 0 },
            data: { label: child.title, onClick: () => onNodeClickRef.current(child), isCompleted: child.isCompleted },
          });
          edges.push({
            id: `lchild-edge-${l.id}-${child.id}`,
            source: `link-${l.id}`,
            target: `lchild-${l.id}-${child.id}`,
            type: "smoothstep",
            style: { stroke: "#1976d2", strokeWidth: 1 },
          });
        });
      }
    });

    Object.entries(childLinks).forEach(([childId, clinks]) => {
      clinks.forEach((l) => {
        const nodeId = `clink-${childId}-${l.id}`;
        nodes.push({
          id: nodeId,
          type: "taskNode",
          position: { x: 0, y: 0 },
          data: { label: l.title, onClick: () => onNodeClickRef.current(l), isCompleted: l.isCompleted },
          style: { background: "#9c27b0" },
        });
        edges.push({
          id: `clink-edge-${childId}-${l.id}`,
          source: nodeId,
          target: `child-${childId}`,
          type: "smoothstep",
          style: { stroke: "#9c27b0", strokeWidth: 1, strokeDasharray: "4 2" },
        });
      });
    });

    const layouted = layoutGraph(nodes, edges, taskId);
    return { nodes: layouted, edges };
  }, [taskId, subtasks, siblings, links, parentTask, childLinks, linkFamilies]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges]);

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
