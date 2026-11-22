import { useState, useEffect, useRef, useCallback } from "react";
import {
  Box, Typography, Stack, TextField, Button, Paper, IconButton, Tooltip, Chip, LinearProgress,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Link as LinkIcon,
  ArrowForward as ArrowForwardIcon,
  Lightbulb as LightbulbIcon,
  CenterFocusStrong as CenterIcon,
  AutoAwesome as AiIcon,
} from "@mui/icons-material";
import { createTask, getTask, listTasks, deleteTask, generateMindmapIdeasAi } from "../api/tasksApi";
import { mindmapsApi, type MindMapBoard, type MindNode, type MindEdge } from "../api/mindmapsApi";
import { useNotify } from "../context/NotifyContext";

/** Früherer Speicherort im Browser – wird beim ersten Laden einmalig übernommen. */
const LEGACY_STORAGE_KEY = "taskmaster_gtd_mindmaps_v1";
const PALETTE = ["#1976d2", "#e06c00", "#2d8c4a", "#7b5ea7", "#c43e2c", "#00838f"];
const CANVAS_MIN_WIDTH = 900;
const SAVE_DELAY_MS = 700;

type BoardContent = Omit<MindMapBoard, "id">;
const contentOf = (b: MindMapBoard): BoardContent => ({ title: b.title, nodes: b.nodes, extraEdges: b.extraEdges });
const fingerprint = (b: MindMapBoard) => JSON.stringify(contentOf(b));

const DEFAULT_BOARD: BoardContent = {
  title: "Meine erste GTD-Mindmap",
  nodes: [
    { id: "root", text: "Zentrales Thema", x: 420, y: 220, color: "#1976d2", parentId: null },
    { id: "n1", text: "Idee 1 (verschieb mich!)", x: 180, y: 120, color: "#e06c00", parentId: "root" },
    { id: "n2", text: "Idee 2 (+ für Unter-Ast)", x: 660, y: 120, color: "#2d8c4a", parentId: "root" },
  ],
  extraEdges: [],
};

function readLegacyBoards(): BoardContent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "[]") as MindMapBoard[];
    return Array.isArray(parsed) ? parsed.map(contentOf) : [];
  } catch {
    return [];
  }
}

/**
 * Lädt die Boards; beim allerersten Mal werden Browser-Boards übernommen bzw.
 * ein Beispiel angelegt. Gleichzeitige Aufrufe (React StrictMode ruft Effekte
 * doppelt auf) teilen sich eine Anfrage, damit nichts doppelt entsteht.
 */
let inflightLoad: Promise<{ boards: MindMapBoard[]; imported: number }> | null = null;

function loadBoards() {
  if (inflightLoad) return inflightLoad;
  const run = (async () => {
    const list = await mindmapsApi.list();
    if (list.length > 0) return { boards: list, imported: 0 };
    const legacy = readLegacyBoards();
    const created: MindMapBoard[] = [];
    for (const content of legacy.length > 0 ? legacy : [DEFAULT_BOARD]) created.push(await mindmapsApi.create(content));
    if (legacy.length > 0) localStorage.removeItem(LEGACY_STORAGE_KEY);
    return { boards: created, imported: legacy.length };
  })();
  inflightLoad = run;
  run.finally(() => { if (inflightLoad === run) inflightLoad = null; }).catch(() => {});
  return run;
}

export function BrainstormingPage() {
  const [boards, setBoards] = useState<MindMapBoard[] | null>(null);
  const [activeBoardId, setActiveBoardId] = useState("");
  const [newBoardTitle, setNewBoardTitle] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const savedRef = useRef(new Map<string, string>());
  const boardsRef = useRef<MindMapBoard[] | null>(null);
  const notify = useNotify();

  boardsRef.current = boards;

  /* ---------- Laden (inkl. einmaliger Übernahme aus dem Browser) ---------- */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { boards: list, imported } = await loadBoards();
        if (!active) return;
        if (imported > 0) notify(`${imported} Mindmap(s) vom Gerät übernommen – jetzt auf allen Geräten verfügbar`);
        list.forEach((b) => savedRef.current.set(b.id, fingerprint(b)));
        setBoards(list);
        setActiveBoardId(list[0].id);
        void pruneFinishedNodes(list);
      } catch {
        notify("Mindmaps konnten nicht geladen werden", "error");
      }
    })();
    return () => { active = false; };
  }, []);

  /* ---------- Automatisch speichern (verzögert, nur geänderte Boards) ---------- */
  const flush = useCallback(() => {
    for (const board of boardsRef.current ?? []) {
      const fp = fingerprint(board);
      if (savedRef.current.get(board.id) === fp) continue;
      savedRef.current.set(board.id, fp);
      mindmapsApi.update(board.id, contentOf(board)).catch(() => {
        savedRef.current.delete(board.id);
        notify("Mindmap konnte nicht gespeichert werden", "error");
      });
    }
  }, [notify]);

  useEffect(() => {
    if (!boards || draggingId) return;
    const timer = window.setTimeout(flush, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [boards, draggingId, flush]);

  useEffect(() => () => flush(), [flush]);

  /**
   * Knoten, deren übernommene Aufgabe erledigt oder gelöscht ist, verschwinden;
   * ihre Unteräste rücken eine Ebene hoch. Knoten ohne verknüpfte Aufgabe bleiben.
   */
  const pruneFinishedNodes = async (list: MindMapBoard[]) => {
    const ids = [...new Set(list.flatMap((b) => b.nodes.filter((n) => n.parentId && n.gtdTaskId).map((n) => n.gtdTaskId!)))];
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => getTask(id)));
    const finished = new Set(ids.filter((id, i) => {
      const r = results[i];
      return r.status === "rejected" || r.value.isCompleted;
    }));
    if (finished.size === 0) return;
    setBoards((prev) => prev?.map((board) => {
      const gone = board.nodes.filter((n) => n.parentId && n.gtdTaskId && finished.has(n.gtdTaskId));
      if (gone.length === 0) return board;
      const goneIds = new Set(gone.map((n) => n.id));
      const lift = (parentId: string | null): string | null => {
        let pid = parentId;
        while (pid && goneIds.has(pid)) pid = board.nodes.find((n) => n.id === pid)?.parentId ?? null;
        return pid;
      };
      return {
        ...board,
        nodes: board.nodes.filter((n) => !goneIds.has(n.id)).map((n) => ({ ...n, parentId: lift(n.parentId) })),
        extraEdges: board.extraEdges.filter((e) => !goneIds.has(e.from) && !goneIds.has(e.to)),
      };
    }) ?? null);
  };

  if (!boards) return <LinearProgress />;

  const activeBoard = boards.find((b) => b.id === activeBoardId) || boards[0];

  const updateBoard = (boardId: string, fix: (b: MindMapBoard) => MindMapBoard) =>
    setBoards((prev) => prev?.map((b) => (b.id === boardId ? fix(b) : b)) ?? null);
  const updateActiveBoard = (fix: (b: MindMapBoard) => MindMapBoard) => updateBoard(activeBoard.id, fix);
  const linkNodeToTask = (boardId: string, nodeId: string, taskId: string) =>
    updateBoard(boardId, (b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === nodeId ? { ...n, gtdTaskId: taskId } : n)) }));

  /* ---------- Übernahme in TaskMaster ---------- */
  const findOpenTaskByTitle = async (taskTitle: string) => {
    const res = await listTasks({ isCompleted: false, search: taskTitle.trim(), pageSize: 100 });
    return res.items.find((t) => t.title.trim().toLowerCase() === taskTitle.trim().toLowerCase());
  };

  /**
   * Wurzel → Projekt (mit allen direkten Ästen als Schritten), Ast → Schritt am
   * Projekt des Elternknotens. Den Nächsten Schritt bestimmt der Server: der
   * erste Schritt wird es, die übrigen rücken nach dem Erledigen nach.
   */
  const handleSendToGtd = async (board: MindMapBoard, node: MindNode, silent = false) => {
    try {
      if (!node.parentId) {
        let project = node.gtdTaskId ? await getTask(node.gtdTaskId).catch(() => undefined) : undefined;
        if (!project || project.isCompleted) project = await findOpenTaskByTitle(node.text);
        let projectCreated = false;
        if (!project) {
          project = await createTask({ title: node.text, description: `Projekt aus Mindmap „${board.title}“ übernommen.` });
          projectCreated = true;
        }
        linkNodeToTask(board.id, node.id, project.id);

        let added = 0;
        for (const child of board.nodes.filter((n) => n.parentId === node.id)) {
          if (child.gtdTaskId || await findOpenTaskByTitle(child.text)) continue;
          const step = await createTask({ title: child.text, parentId: project.id });
          linkNodeToTask(board.id, child.id, step.id);
          added++;
        }
        if (projectCreated || added > 0) notify(`Projekt „${node.text}“ aktualisiert (+${added} Schritt(e))`);
        else if (!silent) notify(`Projekt „${node.text}“ und alle Schritte existieren bereits`, "info");
        return;
      }

      if (node.gtdTaskId || await findOpenTaskByTitle(node.text)) {
        if (!silent) notify(`„${node.text}“ existiert bereits in deinen offenen Aufgaben`, "info");
        return;
      }
      const parentNode = board.nodes.find((n) => n.id === node.parentId);
      const parentTaskId = parentNode?.gtdTaskId ?? (parentNode ? (await findOpenTaskByTitle(parentNode.text))?.id : undefined);
      const task = await createTask({
        title: node.text,
        description: parentNode
          ? `Schritt zum Projekt „${parentNode.text}“.`
          : `Aus Mindmap „${board.title}“ übernommen.`,
        ...(parentTaskId ? { parentId: parentTaskId } : { status: "next" as const }),
      });
      linkNodeToTask(board.id, node.id, task.id);
      notify(parentTaskId ? `„${node.text}“ an Projekt „${parentNode?.text}“ angehängt` : `„${node.text}“ als Nächster Schritt übernommen`);
    } catch (err) {
      console.error("GTD-Sync-Fehler:", err);
      notify("Fehler beim Übertragen an GTD", "error");
    }
  };

  /* ---------- Boards ---------- */
  const handleCreateBoard = async () => {
    const title = newBoardTitle.trim();
    if (!title) return;
    try {
      const board = await mindmapsApi.create({
        title,
        nodes: [{ id: `root-${crypto.randomUUID()}`, text: title, x: 420, y: 220, color: "#1976d2", parentId: null }],
        extraEdges: [],
      });
      savedRef.current.set(board.id, fingerprint(board));
      setBoards((prev) => [...(prev ?? []), board]);
      setActiveBoardId(board.id);
      setNewBoardTitle("");
      void handleSendToGtd(board, board.nodes[0], true);
    } catch {
      notify("Mindmap konnte nicht angelegt werden", "error");
    }
  };

  const handleDeleteBoard = async (board: MindMapBoard) => {
    try {
      await mindmapsApi.remove(board.id);
      for (const n of board.nodes) {
        if (n.parentId && n.gtdTaskId) await deleteTask(n.gtdTaskId).catch(() => {});
      }
      const rest = boards.filter((x) => x.id !== board.id);
      setBoards(rest);
      if (activeBoardId === board.id && rest[0]) setActiveBoardId(rest[0].id);
    } catch {
      notify("Mindmap konnte nicht gelöscht werden", "error");
    }
  };

  /* ---------- Knoten ---------- */
  const handleAddChild = (parent: MindNode) => {
    const siblings = activeBoard.nodes.filter((n) => n.parentId === parent.id);
    const angle = (siblings.length * 0.9) - 0.6;
    const newNode: MindNode = {
      id: `node-${crypto.randomUUID()}`,
      text: "Neue Idee",
      x: Math.max(40, Math.min(CANVAS_MIN_WIDTH - 200, Math.round(parent.x + Math.cos(angle) * 200))),
      y: Math.max(40, Math.min(460, Math.round(parent.y + 110 + Math.sin(angle) * 50))),
      color: PALETTE[activeBoard.nodes.length % PALETTE.length],
      parentId: parent.id,
    };
    updateActiveBoard((b) => ({ ...b, nodes: [...b.nodes, newNode] }));
    startEditing(newNode);
  };

  const startEditing = (node: MindNode) => {
    setEditingId(node.id);
    setEditText(node.text);
  };

  /** Löscht den Knoten samt Unterästen – und nur die damit verknüpften Aufgaben. */
  const handleDeleteNode = (nodeId: string) => {
    const toDelete = new Set<string>([nodeId]);
    let added = true;
    while (added) {
      added = false;
      for (const n of activeBoard.nodes) {
        if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
          toDelete.add(n.id);
          added = true;
        }
      }
    }
    // Kinder zuerst löschen, sonst blockiert der Server (offene Unteraufgaben).
    const linked = activeBoard.nodes.filter((n) => toDelete.has(n.id) && n.gtdTaskId).reverse();
    void (async () => { for (const n of linked) await deleteTask(n.gtdTaskId!).catch(() => {}); })();
    updateActiveBoard((b) => ({
      ...b,
      nodes: b.nodes.filter((n) => !toDelete.has(n.id)),
      extraEdges: b.extraEdges.filter((e) => !toDelete.has(e.from) && !toDelete.has(e.to)),
    }));
  };

  const handleNodeClick = (node: MindNode) => {
    if (!linkingFromId) return;
    if (linkingFromId === node.id) {
      setLinkingFromId(null);
      return;
    }
    const same = (e: MindEdge) => (e.from === linkingFromId && e.to === node.id) || (e.from === node.id && e.to === linkingFromId);
    const exists = activeBoard.extraEdges.some(same);
    updateActiveBoard((b) => ({
      ...b,
      extraEdges: exists ? b.extraEdges.filter((e) => !same(e)) : [...b.extraEdges, { from: linkingFromId, to: node.id, dashed: true }],
    }));
    setLinkingFromId(null);
    notify(exists ? "Verknüpfung entfernt" : "Verknüpfung erstellt!");
  };

  /* ---------- Ziehen (Maus, Stift und Finger über Pointer-Events) ---------- */
  const handlePointerDown = (e: React.PointerEvent, node: MindNode) => {
    if (editingId === node.id || e.button !== 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingId(node.id);
    setDragOffset({ x: e.clientX - rect.left - node.x, y: e.clientY - rect.top - node.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = Math.max(10, Math.min(rect.width - 170, e.clientX - rect.left - dragOffset.x));
    const ny = Math.max(10, Math.min(rect.height - 70, e.clientY - rect.top - dragOffset.y));
    updateActiveBoard((b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === draggingId ? { ...n, x: nx, y: ny } : n)) }));
  };

  /* ---------- KI ---------- */
  const handleAiGenerateIdeas = async () => {
    const board = activeBoard;
    const rootNode = board.nodes.find((n) => !n.parentId);
    const topic = (rootNode?.text || board.title).trim();
    setAiGenerating(true);
    try {
      const ideas = await generateMindmapIdeasAi(topic);
      if (ideas.length === 0) {
        notify("Keine Ideen zurückerhalten", "warning");
        return;
      }
      const parentId = rootNode?.id || board.nodes[0].id;
      const baseX = Math.min(CANVAS_MIN_WIDTH - 200, (rootNode?.x ?? 180) + 320);
      const baseY = Math.max(60, (rootNode?.y ?? 200) - ((ideas.length - 1) * 55));
      const newNodes: MindNode[] = ideas.map((idea, idx) => ({
        id: `node-${crypto.randomUUID()}`,
        text: idea,
        x: baseX,
        y: baseY + idx * 105,
        parentId,
        color: PALETTE[idx % PALETTE.length],
      }));
      const updated = { ...board, nodes: [...board.nodes, ...newNodes] };
      updateBoard(board.id, () => updated);
      if (rootNode) await handleSendToGtd(updated, rootNode, true);
      notify(`${ideas.length} KI-Schritte generiert & in GTD übernommen!`);
    } catch {
      notify("KI-Fehler: Bitte Schlüssel unter Verwaltung → Einstellungen prüfen", "error");
    } finally {
      setAiGenerating(false);
    }
  };

  /* ---------- Darstellung ---------- */
  const nodeMap = new Map(activeBoard.nodes.map((n) => [n.id, n]));
  const treeEdges: MindEdge[] = activeBoard.nodes
    .filter((n) => n.parentId && nodeMap.has(n.parentId))
    .map((n) => ({ from: n.parentId!, to: n.id, dashed: false }));
  const allEdges = [...treeEdges, ...activeBoard.extraEdges];
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2} mb={2}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <LightbulbIcon color="primary" fontSize="large" />
          <Typography variant="h4">Brainstorming</Typography>
        </Stack>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ flex: { xs: "1 1 100%", sm: "0 1 auto" } }}>
          <TextField
            size="small"
            placeholder="Neue Mindmap..."
            value={newBoardTitle}
            onChange={(e) => setNewBoardTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleCreateBoard(); }}
            sx={{ flex: "1 1 160px" }}
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => void handleCreateBoard()} disabled={!newBoardTitle.trim()}>
            Neu
          </Button>
          <Button
            variant="outlined" color="secondary" startIcon={<AiIcon />}
            onClick={() => void handleAiGenerateIdeas()} disabled={aiGenerating} sx={{ whiteSpace: "nowrap" }}
          >
            {aiGenerating ? "KI denkt..." : "KI-Ideen"}
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" useFlexGap alignItems="center">
        {boards.map((b) => (
          <Chip
            key={b.id}
            label={b.title}
            color={b.id === activeBoard.id ? "primary" : "default"}
            variant={b.id === activeBoard.id ? "filled" : "outlined"}
            onClick={() => { setActiveBoardId(b.id); setLinkingFromId(null); }}
            onDelete={boards.length > 1 ? () => void handleDeleteBoard(b) : undefined}
          />
        ))}
        {linkingFromId && (
          <Chip color="warning" label="Ziel-Knoten antippen zum Verknüpfen (oder hier abbrechen)" onDelete={() => setLinkingFromId(null)} />
        )}
      </Stack>

      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
        Knoten ziehen zum Verschieben • Stift oder Doppelklick zum Umbenennen • (+) Unter-Ast • Link: Querverbindung •
        Pfeil: in TaskMaster übernehmen • Speichert automatisch – auf allen Geräten.
      </Typography>

      <Box sx={{ overflowX: "auto", borderRadius: 2 }}>
        <Paper
          ref={canvasRef}
          variant="outlined"
          onPointerMove={handlePointerMove}
          onPointerUp={() => setDraggingId(null)}
          onPointerCancel={() => setDraggingId(null)}
          onClick={() => { if (linkingFromId) setLinkingFromId(null); }}
          sx={{
            position: "relative",
            width: "100%",
            minWidth: CANVAS_MIN_WIDTH,
            height: 560,
            overflow: "hidden",
            bgcolor: "background.default",
            backgroundImage: "radial-gradient(rgba(128,128,128,0.22) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
            userSelect: "none",
            touchAction: "pan-x pan-y",
            borderRadius: 2,
          }}
        >
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {allEdges.map((edge, idx) => {
              const a = nodeMap.get(edge.from);
              const b = nodeMap.get(edge.to);
              if (!a || !b) return null;
              const x1 = a.x + 85;
              const y1 = a.y + 24;
              const x2 = b.x + 85;
              const y2 = b.y + 24;
              const cx = (x1 + x2) / 2;
              return (
                <path
                  key={`${edge.from}-${edge.to}-${idx}`}
                  d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                  stroke={edge.dashed ? "#9c27b0" : b.color}
                  strokeWidth={edge.dashed ? 2 : 2.5}
                  strokeDasharray={edge.dashed ? "6,4" : undefined}
                  fill="none"
                />
              );
            })}
          </svg>

          {activeBoard.nodes.map((node) => {
            const isRoot = node.parentId === null;
            const iconColor = (fallback: string) => (isRoot ? "#fff" : fallback);
            return (
              <Paper
                key={node.id}
                elevation={draggingId === node.id ? 8 : 3}
                onPointerDown={(e) => handlePointerDown(e, node)}
                onClick={(e) => { e.stopPropagation(); handleNodeClick(node); }}
                onDoubleClick={(e) => { e.stopPropagation(); startEditing(node); }}
                sx={{
                  position: "absolute",
                  left: node.x,
                  top: node.y,
                  minWidth: 165,
                  maxWidth: 230,
                  p: 1,
                  borderRadius: isRoot ? 3 : 2,
                  border: "2px solid",
                  borderColor: linkingFromId === node.id ? "warning.main" : node.color,
                  bgcolor: isRoot ? node.color : "background.paper",
                  color: isRoot ? "#fff" : "text.primary",
                  cursor: linkingFromId ? "crosshair" : "grab",
                  zIndex: draggingId === node.id ? 10 : 2,
                  touchAction: "none",
                }}
              >
                {editingId === node.id ? (
                  <TextField
                    size="small" autoFocus fullWidth value={editText}
                    onPointerDown={stop}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => {
                      if (editText.trim()) {
                        updateActiveBoard((b) => ({
                          ...b,
                          nodes: b.nodes.map((n) => (n.id === node.id ? { ...n, text: editText.trim() } : n)),
                        }));
                      }
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    inputProps={{ enterKeyHint: "done" }}
                    sx={{ bgcolor: "background.paper", borderRadius: 1 }}
                  />
                ) : (
                  <Typography variant="body2" fontWeight={isRoot ? 700 : 500} sx={{ wordBreak: "break-word", mb: 0.5 }}>
                    {node.text}
                  </Typography>
                )}

                <Stack direction="row" spacing={0.2} justifyContent="flex-end" onPointerDown={stop}>
                  <Tooltip title="Umbenennen">
                    <IconButton size="small" sx={{ color: iconColor("text.secondary"), p: 0.4 }} onClick={(e) => { e.stopPropagation(); startEditing(node); }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Unter-Ast hinzufügen">
                    <IconButton size="small" sx={{ color: iconColor("primary.main"), p: 0.4 }} onClick={(e) => { e.stopPropagation(); handleAddChild(node); }}>
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Mit anderem Knoten verknüpfen">
                    <IconButton size="small" sx={{ color: iconColor("secondary.main"), p: 0.4 }} onClick={(e) => { e.stopPropagation(); setLinkingFromId(node.id); }}>
                      <LinkIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={isRoot ? "Als Projekt in TaskMaster übernehmen" : "Als Schritt in TaskMaster übernehmen"}>
                    <IconButton size="small" sx={{ color: iconColor("success.main"), p: 0.4 }} onClick={(e) => { e.stopPropagation(); void handleSendToGtd(activeBoard, node); }}>
                      <ArrowForwardIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {!isRoot && (
                    <Tooltip title="Knoten & Unter-Äste löschen">
                      <IconButton size="small" sx={{ color: "error.main", p: 0.4 }} onClick={(e) => { e.stopPropagation(); handleDeleteNode(node.id); }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Paper>
            );
          })}

          <Tooltip title="Knoten wieder ordnen">
            <IconButton
              onClick={() => updateActiveBoard((b) => ({
                ...b,
                nodes: b.nodes.map((n, i) => ({ ...n, x: 120 + (i % 4) * 180, y: 80 + Math.floor(i / 4) * 120 })),
              }))}
              sx={{ position: "absolute", right: 12, bottom: 12, bgcolor: "background.paper", border: "1px solid", borderColor: "divider" }}
            >
              <CenterIcon />
            </IconButton>
          </Tooltip>
        </Paper>
      </Box>
    </Box>
  );
}
