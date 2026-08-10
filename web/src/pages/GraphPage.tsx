import { useState, useEffect, useMemo } from "react";
import { Box, Typography, Paper, Alert, CircularProgress, Stack, Chip } from "@mui/material";
import {
  CheckCircle as CheckCircleIcon,
  Link as LinkIcon,
  ExpandMore as ExpandMoreIcon,
} from "@mui/icons-material";
import { listTasks, getAllLinks, type Task, type RelationNode } from "../api/tasksApi";
import { RelationTree } from "../components/tasks/RelationTree";
import { TaskCard } from "../components/tasks/TaskCard";

function toNode(t: Task): RelationNode {
  return {
    id: t.id,
    title: t.title,
    pomodoros: t.pomodoros,
    isCompleted: t.isCompleted,
    parentId: t.parentId,
  };
}

export function GraphPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [linkPairs, setLinkPairs] = useState<{ a: string; b: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const [t, l] = await Promise.all([listTasks({ pageSize: 500 }), getAllLinks()]);
      setTasks(t.items);
      setLinkPairs(l);
    } catch {
      setError("Fehler beim Laden der Aufgaben.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const { childrenMap, rootNodes, linksByTask } = useMemo(() => {
    const map = new Map<string, RelationNode[]>();
    const roots: RelationNode[] = [];
    for (const t of tasks) {
      const node = toNode(t);
      if (t.parentId) {
        const arr = map.get(t.parentId) ?? [];
        arr.push(node);
        map.set(t.parentId, arr);
      } else {
        roots.push(node);
      }
    }

    const byId = new Map<string, RelationNode>();
    for (const t of tasks) byId.set(t.id, toNode(t));
    const links = new Map<string, RelationNode[]>();
    for (const p of linkPairs) {
      const a = byId.get(p.a);
      const b = byId.get(p.b);
      if (a && b) {
        const arrA = links.get(a.id) ?? [];
        if (!arrA.some((x) => x.id === b.id)) { arrA.push(b); links.set(a.id, arrA); }
        const arrB = links.get(b.id) ?? [];
        if (!arrB.some((x) => x.id === a.id)) { arrB.push(a); links.set(b.id, arrB); }
      }
    }

    return { childrenMap: map, rootNodes: roots, linksByTask: links };
  }, [tasks, linkPairs]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h5" fontWeight={600}>Aufgaben-Struktur</Typography>
        <Chip size="small" label={`${tasks.length} Aufgaben`} />
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <CircularProgress size={24} sx={{ mb: 2 }} />}

      {!loading && !error && tasks.length === 0 && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography color="text.secondary" textAlign="center">Keine Aufgaben vorhanden.</Typography>
        </Paper>
      )}

      {!loading && !error && tasks.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <RelationTree
            nodes={rootNodes}
            childrenMap={childrenMap}
            linksByTask={linksByTask}
            currentId={selectedTaskId}
            onNavigate={(id) => setSelectedTaskId(id)}
          />
          <Box sx={{ mt: 2, pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
            <Typography variant="caption" color="text.secondary">
              <Stack direction="row" alignItems="center" gap={0.5} flexWrap="wrap">
                <span>Legende:</span>
                <CheckCircleIcon fontSize="inherit" color="success" /> erledigt
                <LinkIcon fontSize="inherit" color="primary" /> verknüpft
                <ExpandMoreIcon fontSize="inherit" /> aufklappbar
                <Chip size="small" label="aktuell" color="primary" sx={{ height: 16, fontSize: 10 }} />
              </Stack>
            </Typography>
          </Box>
        </Paper>
      )}

      {selectedTaskId && (
        <TaskCard initialTaskId={selectedTaskId} open={!!selectedTaskId} onClose={() => setSelectedTaskId(null)} onUpdated={fetchData} />
      )}
    </Box>
  );
}
