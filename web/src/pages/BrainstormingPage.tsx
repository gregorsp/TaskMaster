import { AutoAwesome as AiIcon } from "@mui/icons-material";
import client from "../api/client";
import { useState, useEffect, useRef } from "react";
import {
  Box, Typography, Stack, TextField, Button, Paper, IconButton, Tooltip, Chip,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Link as LinkIcon,
  ArrowForward as ArrowForwardIcon,
  Lightbulb as LightbulbIcon,
  CenterFocusStrong as CenterIcon,
} from "@mui/icons-material";
import { createTask, listTasks, deleteTask, updateTask, generateMindmapIdeasAi } from "../api/tasksApi";
import {  listCategories, type Category , createCategory } from "../api/categoriesApi";
import { useNotify } from "../context/NotifyContext";

interface MindNode {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  gtdTaskId?: string;
  parentId: string | null;
}

interface MindEdge {
  from: string;
  to: string;
  dashed?: boolean;
}

interface MindMapBoard {
  id: string;
  title: string;
  nodes: MindNode[];
  extraEdges: MindEdge[];
}

const STORAGE_KEY = "taskmaster_gtd_mindmaps_v1";
const PALETTE = ["#1976d2", "#e06c00", "#2d8c4a", "#7b5ea7", "#c43e2c", "#00838f"];

export function BrainstormingPage() {
  const [boards, setBoards] = useState<MindMapBoard[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MindMapBoard[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    return [{
      id: "default-1",
      title: "Meine erste GTD-Mindmap",
      nodes: [
        { id: "root", text: "Zentrales Thema", x: 420, y: 220, color: "#1976d2", parentId: null },
        { id: "n1", text: "Idee 1 (verschieb mich!)", x: 180, y: 120, color: "#e06c00", parentId: "root" },
        { id: "n2", text: "Idee 2 (+ für Unter-Ast)", x: 660, y: 120, color: "#2d8c4a", parentId: "root" },
      ],
      extraEdges: [],
    }];
  });

  const [activeBoardId, setActiveBoardId] = useState<string>(() => boards[0]?.id || "default-1");
  const [newBoardTitle, setNewBoardTitle] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [linkingFromId, setLinkingFromId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const notify = useNotify();

  useEffect(() => {
    listCategories().then(setCategories).catch(() => []);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
    } catch { /* ignore */ }
  }, [boards]);

  const activeBoard = boards.find((b) => b.id === activeBoardId) || boards[0];

  const updateActiveBoard = (fix: (b: MindMapBoard) => MindMapBoard) => {
    setBoards((prev) => prev.map((b) => (b.id === activeBoard.id ? fix(b) : b)));
  };

  const handleCreateBoard = () => {
    if (!newBoardTitle.trim()) return;
    const id = `board-${Date.now()}`;
    const newBoard: MindMapBoard = {
      id,
      title: newBoardTitle.trim(),
      nodes: [{ id: `root-${crypto.randomUUID()}`, text: newBoardTitle.trim(), x: 420, y: 220, color: "#1976d2", parentId: null }],
      extraEdges: [],
    };
    setBoards((prev) => [...prev, newBoard]);
    if (newBoard?.nodes?.[0]) void handleSendToGtd(newBoard.nodes[0], true);
    setActiveBoardId(id);
    setNewBoardTitle("");
  };

  const handleAddChild = (parent: MindNode) => {
    const siblings = activeBoard.nodes.filter((n) => n.parentId === parent.id);
    const angle = (siblings.length * 0.9) - 0.6;
    const newNode: MindNode = {
      id: `node-${crypto.randomUUID()}`,
      text: "Neue Idee",
      x: Math.max(40, Math.min(820, Math.round(parent.x + Math.cos(angle) * 200))),
      y: Math.max(40, Math.min(460, Math.round(parent.y + 110 + Math.sin(angle) * 50))),
      color: PALETTE[activeBoard.nodes.length % PALETTE.length],
      parentId: parent.id,
    };
    updateActiveBoard((b) => ({ ...b, nodes: [...b.nodes, newNode] }));
    setEditingId(newNode.id);
    setEditText(newNode.text);
  };

  const deleteBoardTasksFromGtd = async (boardToDelete: MindMapBoard) => {
    for (const cn of boardToDelete.nodes.filter((n) => Boolean(n.parentId))) {
      if (cn.gtdTaskId) { try { await deleteTask(cn.gtdTaskId); } catch {} }
    }
  };
  const removeTaskByTitle = async (taskTitle: string) => {
    try {
      const clean = taskTitle.trim().toLowerCase();
      if (!clean || clean === "neue idee" || clean === "meine erste gtd-mindmap") return;
      const openTasks = await listTasks({ isCompleted: false, search: taskTitle.trim() });
      for (const t of openTasks.items) {
        if (t.title.trim().toLowerCase() === clean) {
          await deleteTask(t.id);
        }
      }
    } catch {}
  };
  const handleDeleteNode = (nodeId: string) => {
    const nodeToRemove = activeBoard?.nodes.find((n) => n.id === nodeId);
    if (nodeToRemove) void removeTaskByTitle(nodeToRemove.text);
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
    const exists = activeBoard.extraEdges.some(
      (e) => (e.from === linkingFromId && e.to === node.id) || (e.from === node.id && e.to === linkingFromId)
    );
    updateActiveBoard((b) => ({
      ...b,
      extraEdges: exists
        ? b.extraEdges.filter((e) => !((e.from === linkingFromId && e.to === node.id) || (e.from === node.id && e.to === linkingFromId)))
        : [...b.extraEdges, { from: linkingFromId, to: node.id, dashed: true }],
    }));
    setLinkingFromId(null);
    notify(exists ? "Verklüpfung entfernt" : "Verknüpfung erstellt!");
  };

  useEffect(() => {
    if (!draggingId) return;
    const onMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nx = Math.max(10, Math.min(rect.width - 170, e.clientX - rect.left - dragOffset.x));
      const ny = Math.max(10, Math.min(rect.height - 70, e.clientY - rect.top - dragOffset.y));
      setBoards((prev) =>
        prev.map((b) =>
          b.id === activeBoardId
            ? { ...b, nodes: b.nodes.map((n) => (n.id === draggingId ? { ...n, x: nx, y: ny } : n)) }
            : b
        )
      );
    };
    const onUp = () => setDraggingId(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingId, dragOffset, activeBoardId]);

  const handleMouseDown = (e: React.MouseEvent, node: MindNode) => {
    if (editingId === node.id || e.button !== 0) return;
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDraggingId(node.id);
    setDragOffset({ x: e.clientX - rect.left - node.x, y: e.clientY - rect.top - node.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = Math.max(20, Math.min(rect.width - 160, e.clientX - rect.left - dragOffset.x));
    const ny = Math.max(20, Math.min(rect.height - 60, e.clientY - rect.top - dragOffset.y));
    updateActiveBoard((b) => ({
      ...b,
      nodes: b.nodes.map((n) => (n.id === draggingId ? { ...n, x: nx, y: ny } : n)),
    }));
  };

  const handlePointerUp = () => {
    setDraggingId(null);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await listTasks({ isCompleted: false });
        if (!active) return;
        const openTitles = new Set(res.items.map((t) => t.title.trim().toLowerCase()));
        setBoards((prev) =>
          prev.map((board) => {
            const rootNode = board.nodes.find((n) => !n.parentId);
            const rootTitle = (rootNode?.text || board.title).trim().toLowerCase();
            if (rootTitle === "meine erste gtd-mindmap") return board;
            return {
              ...board,
              nodes: board.nodes.filter((n) => {
                if (!n.parentId) return true;
                const t = n.text.trim().toLowerCase();
                if (t === "neue idee") return true;
                return openTitles.has(t);
              }),
            };
          })
        );
      } catch {}
    })();
    return () => { active = false; };
  }, []);

  const [aiGenerating, setAiGenerating] = useState(false);

  const handleAiGenerateIdeas = async () => {
    if (!activeBoard) return;
    const rootNode = activeBoard.nodes.find((n) => !n.parentId);
    const topic = (rootNode?.text || activeBoard.title).trim();
    const provider = localStorage.getItem("taskmaster_ai_provider") || "gemini";
    const apiKey = provider === "gemini"
      ? (localStorage.getItem("taskmaster_gemini_key") || localStorage.getItem("taskmaster_ai_api_key") || "")
      : (localStorage.getItem("taskmaster_deepseek_key") || localStorage.getItem("taskmaster_ai_api_key") || "");
    if (!apiKey) {
      notify("Bitte zuerst links unter GTD → KI-Einstellungen einen API-Key hinterlegen", "warning");
      return;
    }
    setAiGenerating(true);
    try {
      const ideas = await generateMindmapIdeasAi(topic, apiKey);
      if (ideas.length === 0) {
        notify("Keine Ideen zurückerhalten", "warning");
        return;
      }
      const parentId = rootNode?.id || activeBoard.nodes[0].id;
      const baseX = (rootNode?.x ?? 180) + 320;
      const baseY = Math.max(60, (rootNode?.y ?? 200) - ((ideas.length - 1) * 55));
      const colors = ["#1976d2", "#2e7d32", "#ed6c02", "#9c27b0", "#0288d1", "#d32f2f"];
      const newNodes = ideas.map((idea, idx) => ({
        id: "node-" + Date.now() + "-" + idx,
        text: idea,
        x: baseX,
        y: baseY + idx * 105,
        parentId, color: colors[idx % colors.length],
      }));
      updateActiveBoard((b) => ({ ...b, nodes: [...b.nodes, ...newNodes] }));
      for (const n of newNodes) {
        await handleSendToGtd(n, true);
      }
      notify(ideas.length + " KI-Schritte generiert & in GTD übernommen!");
    } catch {
      notify("KI-Fehler: Bitte Key unter KI-Einstellungen prüfen", "error");
    } finally {
      setAiGenerating(false);
    }
  };

  const handleSendToGtd = async (node: MindNode, silent = false) => {
    try {
      const isMainNode = !node.parentId;
      const catsResponse: any = await listCategories();
      const catsList: Array<{ id: string; name: string }> = Array.isArray(catsResponse)
        ? catsResponse
        : (catsResponse?.categories || catsResponse?.items || catsResponse?.data || []);

      let projCat = catsList.find((cat) => cat.name.toLowerCase().includes("projekt"));
      if (!projCat) {
        const createdP: any = await createCategory({ name: "Projekte", color: "#ed6c02" });
        projCat = createdP?.category || createdP?.data || createdP;
      }

      let nextCat = catsList.find((cat) => cat.name.toLowerCase().includes("n\u00e4chste"));
      if (!nextCat) {
        const createdN: any = await createCategory({ name: "N\u00e4chste Schritte", color: "#1976d2" });
        nextCat = createdN?.category || createdN?.data || createdN;
      }

      const findOpenTaskByTitle = async (taskTitle: string) => {
        const res = await listTasks({ isCompleted: false, search: taskTitle.trim() });
        return res.items.find((t) => t.title.trim().toLowerCase() === taskTitle.trim().toLowerCase());
      };

      if (isMainNode && activeBoard) {
        let projectTask = await findOpenTaskByTitle(node.text);
        let projectCreated = false;
        if (!projectTask) {
          projectTask = await createTask({
            title: node.text,
            description: `Projekt aus Mindmap „${activeBoard.title}“ übernommen.`,
            categoryIds: projCat?.id ? [projCat.id] : [],
          });
          projectCreated = true;
        }

        const children = activeBoard.nodes.filter((n) => n.parentId === node.id);
        let addedChildren = 0;
        for (const child of children) {
          const existingChild = await findOpenTaskByTitle(child.text);
          if (!existingChild) {
            await createTask({
              title: child.text,
              description: `N\u00e4chster Schritt zum Projekt „${node.text}“.`,
              parentId: projectTask.id,
              categoryIds: nextCat?.id ? [nextCat.id] : [],
            });
            addedChildren++;
          }
        }

        if (!projectCreated && addedChildren === 0) {
          if (!silent) notify(`Projekt „${node.text}“ und alle Unteraufgaben existieren bereits!`, "info");
        } else {
          notify(`Projekt „${node.text}“ aktualisiert (+${addedChildren} neue Unteraufgabe(n))!`);
        }
      } else {
        const existingTask = await findOpenTaskByTitle(node.text);
        if (existingTask) {
          if (!silent) notify(`„${node.text}“ existiert bereits in deinen offenen Aufgaben!`, "info");
          return;
        }

        const parentNode = activeBoard?.nodes.find((n) => n.id === node.parentId);
        const existingParent = parentNode ? await findOpenTaskByTitle(parentNode.text) : undefined;

        await createTask({
          title: node.text,
          description: parentNode
            ? `N\u00e4chster Schritt zum Projekt „${parentNode.text}“.`
            : `Aus Mindmap „${activeBoard?.title || "Brainstorming"}“ übernommen.`,
          parentId: existingParent?.id,
          categoryIds: nextCat?.id ? [nextCat.id] : [],
        });

        if (existingParent) {
          notify(`„${node.text}“ als N\u00e4chster Schritt an Projekt „${parentNode?.text}“ angehängt!`);
        } else {
          notify(`„${node.text}“ als N\u00e4chster Schritt an GTD gesendet!`);
        }
      }
    } catch (err) {
      console.error("GTD-Sync-Fehler:", err);
      notify("Fehler beim Übertragen an GTD", "error");
    }
  };

  const nodeMap = new Map(activeBoard.nodes.map((n) => [n.id, n]));
  const treeEdges: MindEdge[] = activeBoard.nodes
    .filter((n) => n.parentId && nodeMap.has(n.parentId))
    .map((n) => ({ from: n.parentId!, to: n.id, dashed: false }));
  const allEdges = [...treeEdges, ...activeBoard.extraEdges];

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2} mb={2}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <LightbulbIcon color="primary" fontSize="large" />
          <Typography variant="h4">Brainstorming & Mindmaps</Typography>
        </Stack>

        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            placeholder="Neue Mindmap..."
            value={newBoardTitle}
            onChange={(e) => setNewBoardTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreateBoard(); }}
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateBoard} disabled={!newBoardTitle.trim()}>
            New
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<AiIcon />}
            onClick={() => void handleAiGenerateIdeas()}
            disabled={aiGenerating}
            sx={{ whiteSpace: "nowrap" }}
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
            onDelete={boards.length > 1 ? () => { void deleteBoardTasksFromGtd(b);
              const rest = boards.filter((x) => x.id !== b.id);
              setBoards(rest);
              if (activeBoardId === b.id && rest[0]) setActiveBoardId(rest[0].id);
            } : undefined}
          />
        ))}
        {linkingFromId && (
          <Chip
            color="warning"
            label="Ziel-Knoten anklicken zum Verknüpfen (oder hier abbrechen)"
            onDelete={() => setLinkingFromId(null)}
          />
        )}
      </Stack>

      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
        Bedienung: Knoten per Drag & Drop verschieben • Doppelklick zum Umbenennen • (+) für Unter-Ast • (Link) für Querverbindung • Text bestätigen (Enter) übernimmt automatisch in GTD
      </Typography>

      <Paper
        ref={canvasRef}
        variant="outlined"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={() => { if (linkingFromId) setLinkingFromId(null); }}
        sx={{
          position: "relative",
          width: "100%",
          height: 560,
          overflow: "hidden",
          bgcolor: "background.default",
          backgroundImage: "radial-gradient(rgba(128,128,128,0.22) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          userSelect: "none", touchAction: "none",
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
          const isLinkingSource = linkingFromId === node.id;
          return (
            <Paper
              key={node.id}
              elevation={draggingId === node.id ? 8 : 3}
              onMouseDown={(e) => handleMouseDown(e, node)}
              onClick={(e) => { e.stopPropagation(); handleNodeClick(node); }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(node.id);
                setEditText(node.text);
              }}
              sx={{
                position: "absolute",
                left: node.x,
                top: node.y,
                minWidth: 165,
                maxWidth: 230,
                p: 1,
                borderRadius: isRoot ? 3 : 2,
                border: "2px solid",
                borderColor: isLinkingSource ? "warning.main" : node.color,
                bgcolor: isRoot ? node.color : "background.paper",
                color: isRoot ? "#fff" : "text.primary",
                cursor: linkingFromId ? "crosshair" : "grab",
                zIndex: draggingId === node.id ? 10 : 2,
              }}
            >
              {editingId === node.id ? (
                <TextField
                  size="small"
                  autoFocus
                  fullWidth
                  value={editText}
                  onMouseDown={(e) => e.stopPropagation()}
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
                  sx={{ bgcolor: "background.paper", borderRadius: 1 }}
                />
              ) : (
                <Typography variant="body2" fontWeight={isRoot ? 700 : 500} sx={{ wordBreak: "break-word", mb: 0.5 }}>
                  {node.text}
                </Typography>
              )}

              <Stack direction="row" spacing={0.2} justifyContent="flex-end" onMouseDown={(e) => e.stopPropagation()}>
                <Tooltip title="Unter-Ast hinzufügen">
                  <IconButton size="small" sx={{ color: isRoot ? "#fff" : "primary.main", p: 0.3 }} onClick={(e) => { e.stopPropagation(); handleAddChild(node); }}>
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Mit anderem Knoten verknüpfen">
                  <IconButton size="small" sx={{ color: isRoot ? "#fff" : "secondary.main", p: 0.3 }} onClick={(e) => { e.stopPropagation(); setLinkingFromId(node.id); }}>
                    <LinkIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {true && (
                  <>
                    <Tooltip title="Als N\u00e4chster Schritt in TaskMaster übernehmen">
                      <IconButton size="small" sx={{ color: isRoot ? "#fff" : "success.main", p: 0.3 }} onClick={(e) => { e.stopPropagation(); void handleSendToGtd(node); }}>
                        <ArrowForwardIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {!isRoot && (<Tooltip title="Knoten & Unter-Äste löschen"><IconButton size="small" sx={{ color: "error.main", p: 0.3 }} onClick={() => handleDeleteNode(node.id)}><DeleteIcon fontSize="inherit" /></IconButton></Tooltip>)}
                  </>
                )}
              </Stack>
            </Paper>
          );
        })}

        <Tooltip title="Knoten wieder in die Mitte holen">
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
  );
}
