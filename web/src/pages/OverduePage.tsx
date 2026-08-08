import { useState, useEffect } from "react";
import { Box, Typography } from "@mui/material";
import { listOverdueTasks, type Task } from "../api/tasksApi";
import { TaskListView } from "../components/tasks/TaskListView";

function daysLateBadge(task: Task) {
  const due = task.effectiveDueAt || task.dueAt;
  const dueDate = due ? new Date(due) : null;
  const daysLate = dueDate ? Math.ceil((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
  return (
    <Typography variant="caption" color="error" fontWeight={600}>
      {daysLate} {daysLate === 1 ? "Tag" : "Tage"}
    </Typography>
  );
}

export function OverduePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listOverdueTasks();
      setTasks(data.items);
    } catch (e) {
      console.error("Overdue fetch error:", e);
      setError("Fehler beim Laden der überfälligen Aufgaben.");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <Box>
      <Typography variant="h4" mb={2}>
        Überfällige Aufgaben ({tasks.length})
      </Typography>

      <TaskListView
        tasks={tasks}
        loading={loading}
        error={error}
        emptyText="Keine überfälligen Aufgaben."
        onUpdated={load}
        extraBadge={daysLateBadge}
      />
    </Box>
  );
}
