import { useState, useEffect } from "react";
import { Dialog, DialogTitle, DialogContent, TextField, Button, Stack, Typography, Alert, Box, Chip } from "@mui/material";
import { Warning as WarningIcon } from "@mui/icons-material";
import { getSubtasks, type Task } from "../../api/tasksApi";
import { OccurrencePicker } from "./OccurrencePicker";

interface Props {
  open: boolean;
  openCount: number;
  totalCount: number;
  taskId: string;
  parentRecurrenceType: string;
  onClose: () => void;
  onForceComplete: (note: string, parentOccurrenceDate?: string) => void;
  onCascadeComplete: (note: string, recurringCompletions: Record<string, string>, parentOccurrenceDate?: string) => void;
}

export function CompleteBlockedDialog({ open, openCount, totalCount, taskId, parentRecurrenceType, onClose, onForceComplete, onCascadeComplete }: Props) {
  const [note, setNote] = useState("");
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [recurringCompletions, setRecurringCompletions] = useState<Record<string, string>>({});
  const [parentOccurrenceDate, setParentOccurrenceDate] = useState("");

  useEffect(() => {
    if (open) {
      getSubtasks(taskId).then((r) => {
        setSubtasks(r.subtasks.filter((s) => !s.isCompleted));
      }).catch(() => setSubtasks([]));
    }
  }, [open, taskId]);

  const nonRecurringSubtasks = subtasks.filter((s) => s.recurrenceType === "none");
  const recurringSubtasks = subtasks.filter((s) => s.recurrenceType !== "none");

  const handleRecurringChange = (subtaskId: string, iso: string) => {
    setRecurringCompletions((prev) => ({ ...prev, [subtaskId]: iso }));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <WarningIcon color="warning" />
        Aufgabe erledigen
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Alert severity="warning">
            {openCount} von {totalCount} Unteraufgaben sind noch nicht erledigt.
          </Alert>

          {nonRecurringSubtasks.length > 0 && (
            <Box>
              <Typography variant="body2" fontWeight={600} mb={0.5}>
                {nonRecurringSubtasks.length} nicht-wiederkehrende Unteraufgaben werden mit erledigt:
              </Typography>
              {nonRecurringSubtasks.map((s) => (
                <Typography key={s.id} variant="body2" color="text.secondary" sx={{ pl: 1 }}>
                  ✓ {s.title}
                </Typography>
              ))}
            </Box>
          )}

          {recurringSubtasks.length > 0 && (
            <Box>
              <Typography variant="body2" fontWeight={600} mb={1}>
                Für {recurringSubtasks.length} wiederkehrende Unteraufgaben Fälligkeit auswählen:
              </Typography>
              {recurringSubtasks.map((s) => (
                <Box key={s.id} sx={{ mb: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {s.title}
                  </Typography>
                  <OccurrencePicker
                    taskId={s.id}
                    value={recurringCompletions[s.id] || ""}
                    onChange={(iso) => handleRecurringChange(s.id, iso)}
                    label="Fälligkeit"
                    count={3}
                  />
                </Box>
              ))}
            </Box>
          )}

          {parentRecurrenceType === "rrule" && (
            <Box>
              <Typography variant="body2" fontWeight={600} mb={1}>
                Diese Aufgabe ist wiederkehrend – welche Fälligkeit erledigen?
              </Typography>
              <OccurrencePicker
                taskId={taskId}
                value={parentOccurrenceDate}
                onChange={setParentOccurrenceDate}
                label="Fälligkeit"
                count={3}
              />
            </Box>
          )}

          <TextField
            label="Notiz (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            rows={2}
            fullWidth
          />

          <Stack direction="row" justifyContent="flex-end" gap={1} flexWrap="wrap">
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="outlined" color="warning" onClick={() => onForceComplete(note, parentOccurrenceDate || undefined)}>
              Nur diese Aufgabe erledigen
            </Button>
            {subtasks.length > 0 && (
              <Button variant="contained" color="warning" onClick={() => onCascadeComplete(note, recurringCompletions, parentOccurrenceDate || undefined)}>
                Alle Unteraufgaben miterledigen
              </Button>
            )}
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
