import { useState, useEffect, useCallback } from "react";
import { Box, Typography, Paper, Stack, CircularProgress } from "@mui/material";
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { listTasks, updateTask, type Task } from "../api/tasksApi";
import { TaskCard } from "../components/tasks/TaskCard";

interface Quadrant {
  label: string;
  important: boolean;
  urgent: boolean;
}

const QUADRANTS: Quadrant[] = [
  { label: "Wichtig + Dringend", important: true, urgent: true },
  { label: "Wichtig + Nicht Dringend", important: true, urgent: false },
  { label: "Nicht Wichtig + Dringend", important: false, urgent: true },
  { label: "Nicht Wichtig + Nicht Dringend", important: false, urgent: false },
];

export function MatrixPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    const res = await listTasks({ pageSize: 200 });
    setTasks(res.items.filter((t: Task) => !t.isCompleted));
    setLoading(false);
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const getQuadrantTasks = (important: boolean, urgent: boolean) =>
    tasks.filter((t) => t.isImportant === important && t.isUrgent === urgent);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const taskId = String(active.id);
    const [imp, urg] = over.id.toString().split("-").map((v) => v === "true");
    await updateTask(taskId, { isImportant: imp, isUrgent: urg });
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, isImportant: imp, isUrgent: urg } : t));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  return (
    <Box>
      <Typography variant="h4" mb={2}>Eisenhower-Matrix</Typography>
      {loading ? (
        <CircularProgress />
      ) : (
        <DndContext onDragEnd={handleDragEnd} sensors={sensors}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 2 }}>
            {QUADRANTS.map((q) => (
              <Droppable key={`${q.important}-${q.urgent}`} id={`${q.important}-${q.urgent}`} label={q.label} count={getQuadrantTasks(q.important, q.urgent).length}>
                {getQuadrantTasks(q.important, q.urgent).map((task) => (
                  <DraggableTask key={task.id} task={task} onClick={() => setSelectedTaskId(task.id)} />
                ))}
              </Droppable>
            ))}
          </Box>
        </DndContext>
      )}
      {selectedTaskId && (
        <TaskCard taskId={selectedTaskId} open={!!selectedTaskId} onClose={() => setSelectedTaskId(null)} onUpdated={fetchTasks} />
      )}
    </Box>
  );
}

function Droppable({ id, label, count, children }: { id: string; label: string; count: number; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      sx={{ p: 2, minHeight: 150, minWidth: 0, bgcolor: "background.paper", overflow: "hidden" }}
    >
      <Typography variant="subtitle2" fontWeight={600} mb={1}>
        {label} ({count})
      </Typography>
      <Stack spacing={1}>{children}</Stack>
    </Paper>
  );
}

function DraggableTask({ task, onClick }: { task: Task; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined;
  return (
    <Paper
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      sx={{
        p: 1.5,
        minWidth: 0,
        cursor: "grab",
        "&:active": { cursor: "grabbing" },
        ...style,
      }}
    >
      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{task.title}</Typography>
      {task.dueAt && (
        <Typography variant="caption" color="text.secondary">
          {new Date(task.dueAt).toLocaleDateString("de-DE")}
        </Typography>
      )}
    </Paper>
  );
}
