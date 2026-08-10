import { useState, useEffect } from "react";
import {
  Dialog, DialogTitle, DialogContent, TextField, Button, Stack, List, ListItemButton,
  ListItemIcon, ListItemText, Typography, Chip, Radio,
} from "@mui/material";
import { listTasks, getTaskLinks, addTaskLink, removeTaskLink, type Task } from "../../api/tasksApi";
import { useNotify } from "../../context/NotifyContext";

interface Props {
  open: boolean;
  taskId: string;
  onClose: () => void;
}

export function LinkTaskDialog({ open, taskId, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const notify = useNotify();

  useEffect(() => {
    if (open) {
      listTasks({ isCompleted: false, pageSize: 200 }).then((r) => setAllTasks(r.items.filter((t) => t.id !== taskId))).catch(() => {});
      getTaskLinks(taskId).then((links) => setLinkedIds(new Set(links.map((l) => l.id)))).catch(() => {});
    }
  }, [open, taskId]);

  const filtered = allTasks.filter((t) =>
    t.id !== taskId && t.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleToggle = async (linkedId: string) => {
    if (linkedIds.has(linkedId)) {
      await removeTaskLink(taskId, linkedId);
      setLinkedIds((prev) => { const next = new Set(prev); next.delete(linkedId); return next; });
      notify("Verknüpfung entfernt");
    } else {
      await addTaskLink(taskId, linkedId);
      setLinkedIds((prev) => new Set(prev).add(linkedId));
      notify("Verknüpfung hinzugefügt");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Verknüpfte Aufgabe hinzufügen</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <TextField
            placeholder="Aufgabe suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
            autoFocus
          />
          <List dense sx={{ maxHeight: 400, overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
            {filtered.map((t) => (
              <ListItemButton key={t.id} onClick={() => handleToggle(t.id)}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Radio checked={linkedIds.has(t.id)} size="small" />
                </ListItemIcon>
                <ListItemText
                  primary={t.title}
                  secondary={
                    <Stack direction="row" gap={1} alignItems="center">
                      {t.pomodoros != null && t.pomodoros > 0 && (
                        <Typography variant="caption" color="text.secondary">{t.pomodoros} SP</Typography>
                      )}
                      {linkedIds.has(t.id) && (
                        <Chip label="verknüpft" size="small" color="primary" variant="outlined" />
                      )}
                    </Stack>
                  }
                />
              </ListItemButton>
            ))}
            {filtered.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
                Keine Aufgaben gefunden.
              </Typography>
            )}
          </List>
          <Stack direction="row" justifyContent="flex-end">
            <Button onClick={onClose}>Schließen</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
