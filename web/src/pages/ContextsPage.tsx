import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Typography, TextField, Button, Stack, Chip, IconButton,
  Dialog, DialogContent, DialogTitle, Alert,
} from "@mui/material";
import { Add as AddIcon, Delete as DeleteIcon } from "@mui/icons-material";
import { listContexts, createContext, deleteContext, type TaskContext } from "../api/contextsApi";
import { useNotify } from "../context/NotifyContext";

const PALETTE = ["#0c66e4","#1982c4","#7b5ea7","#c43e2c","#e06c00","#d4a017","#2d8c4a","#0b8043","#5c6bc0","#ec407a","#8d6e63","#78909c"];

export function ContextsPage() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [contexts, setContexts] = useState<TaskContext[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#1e88e5");

  const load = async () => {
    const data = await listContexts();
    setContexts(data);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await createContext({ name: name.trim(), color });
      setName("");
      setColor("#1e88e5");
      setOpen(false);
      load();
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      notify(err?.response?.data?.error?.message || "Kontext konnte nicht angelegt werden", "error");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteContext(id);
      load();
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      notify(err?.response?.data?.error?.message || "Kontext konnte nicht gelöscht werden", "error");
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">Kontexte</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Neuer Kontext
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Kontexte beschreiben, wo oder womit du eine Aufgabe erledigst (Telefon, Computer, Online …).
        Gleichnamige Kontexte anderer Nutzer erscheinen in der Anzeige als derselbe Kontext.
        Beim Löschen verlieren betroffene Aufgaben die Zuordnung.
      </Alert>

      <Stack spacing={1}>
        {contexts.map((context) => (
          <Stack key={context.id} direction="row" alignItems="center" spacing={2} onClick={() => navigate(`/?contextId=${context.id}`)} sx={{ p: 1.5, borderRadius: 1, bgcolor: "background.paper", border: "1px solid", borderColor: "divider", cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
            <Box sx={{ width: 20, height: 20, borderRadius: "50%", bgcolor: context.color, flexShrink: 0 }} />
            <Typography sx={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}>{context.name}</Typography>
            <Chip size="small" label={context.color} sx={{ fontFamily: "monospace" }} />
            <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDelete(context.id); }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        {contexts.length === 0 && (
          <Typography color="text.secondary" textAlign="center" py={4}>Keine Kontexte.</Typography>
        )}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Neuer Kontext</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth autoFocus />
            <Typography variant="caption" color="text.secondary">Farbe wählen:</Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.8}>
              {PALETTE.map((c) => (
                <Box
                  key={c}
                  onClick={() => setColor(c)}
                  sx={{
                    width: 32, height: 32, borderRadius: "50%", bgcolor: c, cursor: "pointer",
                    border: color === c ? "3px solid #1976d2" : "3px solid transparent",
                    transition: "transform 0.1s", "&:hover": { transform: "scale(1.2)" },
                  }}
                />
              ))}
            </Stack>
            <TextField label="Oder eigene Farbe" type="color" value={color} onChange={(e) => setColor(e.target.value)} fullWidth />
            <Stack direction="row" justifyContent="flex-end" gap={1}>
              <Button onClick={() => setOpen(false)}>Abbrechen</Button>
              <Button variant="contained" onClick={handleCreate} disabled={!name.trim()}>Erstellen</Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
