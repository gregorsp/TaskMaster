import { useState, useEffect } from "react";
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, Alert, CircularProgress,
} from "@mui/material";
import { listOverdueTasks, type Task } from "../api/tasksApi";
import { TaskCard } from "../components/tasks/TaskCard";

export function OverduePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const formatDate = (d: string | null) => {
    if (!d) return "Kein Datum";
    return new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <Box>
      <Typography variant="h4" mb={2}>
        Überfällige Aufgaben ({tasks.length})
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && <CircularProgress size={24} sx={{ mb: 2 }} />}

      {!loading && !error && tasks.length === 0 && (
        <Alert severity="info">Keine überfälligen Aufgaben.</Alert>
      )}

      {tasks.length > 0 && (
      <TableContainer component={Paper}>
        <Table sx={{ tableLayout: "fixed" }}>
          <TableHead>
            <TableRow>
              <TableCell>Titel</TableCell>
              <TableCell sx={{ width: 130 }}>Fällig am</TableCell>
              <TableCell sx={{ width: 95 }}>Überfällig seit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tasks.map((task) => {
              const now = new Date();
              const due = task.effectiveDueAt || task.dueAt;
              const dueDate = due ? new Date(due) : null;
              const daysLate = dueDate ? Math.ceil((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
              return (
                <TableRow key={task.id} hover onClick={() => setSelectedId(task.id)} sx={{ cursor: "pointer" }}>
                  <TableCell sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>{task.title}</TableCell>
                  <TableCell>{dueDate?.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) || formatDate(due)}</TableCell>
                  <TableCell>
                    <Typography color="error" fontWeight={600}>
                      {daysLate} {daysLate === 1 ? "Tag" : "Tage"}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      )}

      {selectedId && (
        <TaskCard taskId={selectedId} open={!!selectedId} onClose={() => setSelectedId(null)} onUpdated={load} />
      )}
    </Box>
  );
}
