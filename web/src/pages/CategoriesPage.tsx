import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Typography, TextField, Button, Stack, Chip, IconButton,
  Dialog, DialogContent, DialogTitle, Alert,
} from "@mui/material";
import { Add as AddIcon, Delete as DeleteIcon } from "@mui/icons-material";
import { listCategories, createCategory, deleteCategory, type Category } from "../api/categoriesApi";
import { useNotify } from "../context/NotifyContext";

const PALETTE = ["#0c66e4","#1982c4","#7b5ea7","#c43e2c","#e06c00","#d4a017","#2d8c4a","#0b8043","#5c6bc0","#ec407a","#8d6e63","#78909c"];

export function CategoriesPage() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [cats, setCats] = useState<Category[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#1976d2");

  const load = async () => {
    const data = await listCategories();
    setCats(data);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await createCategory({ name: name.trim(), color });
      setName("");
      setColor("#1976d2");
      setOpen(false);
      load();
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      notify(err?.response?.data?.error?.message || "Kategorie konnte nicht angelegt werden", "error");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCategory(id);
      load();
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      notify(err?.response?.data?.error?.message || "Kategorie konnte nicht gelöscht werden", "error");
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h4">Kategorien</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Neue Kategorie
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Kategorien gehören dir. Gleichnamige Kategorien anderer Nutzer erscheinen in der Anzeige als dieselbe Kategorie,
        bleiben aber getrennt gespeichert.
      </Alert>

      <Stack spacing={1}>
        {cats.map((cat) => (
          <Stack key={cat.id} direction="row" alignItems="center" spacing={2} onClick={() => navigate(`/?categoryId=${cat.id}`)} sx={{ p: 1.5, borderRadius: 1, bgcolor: "background.paper", border: "1px solid", borderColor: "divider", cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
            <Box sx={{ width: 20, height: 20, borderRadius: "50%", bgcolor: cat.color, flexShrink: 0 }} />
            <Typography sx={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}>{cat.name}</Typography>
            <Chip size="small" label={cat.color} sx={{ fontFamily: "monospace" }} />
            <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDelete(cat.id); }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        {cats.length === 0 && (
          <Typography color="text.secondary" textAlign="center" py={4}>Keine Kategorien.</Typography>
        )}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Neue Kategorie</DialogTitle>
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
            <Typography variant="caption" color="text.secondary">Wird automatisch eine Farbe gewählt, wenn du keine angibst.</Typography>
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
