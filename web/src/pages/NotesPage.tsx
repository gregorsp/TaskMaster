import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { GraphicEq, Mic, NoteAdd, Search } from "@mui/icons-material";
import { useTranscriptionRefresh } from "../asr/useTranscriptionRefresh";
import { createNote, deleteNote, listNotes, type NoteListItem } from "../api/notesApi";
import { AudioRecorder } from "../audio/recorder";
import { NoteDialog } from "../components/notes/NoteDialog";
import { useNotify } from "../context/NotifyContext";

const STATE_COLOR: Record<string, "default" | "success" | "warning" | "error" | "info"> = {
  none: "default",
  pending: "warning",
  running: "info",
  done: "success",
  failed: "error",
};

const STATE_LABEL: Record<string, string> = {
  none: "offen",
  pending: "wartet",
  running: "läuft",
  done: "transkribiert",
  failed: "Fehler",
};

function formatDuration(ms: number): string {
  if (!ms) return "";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")} min`;
}

export function NotesPage() {
  const notify = useNotify();
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [textDialogOpen, setTextDialogOpen] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [recording, setRecording] = useState<{ noteId: string; startedAt: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listNotes({ limit: 50, q: query || undefined, filter: onlyOpen ? "open" : "all" });
      setNotes(result.items);
    } catch {
      notify("Notizen konnten nicht geladen werden", "error");
    }
    setLoading(false);
  }, [query, onlyOpen, notify]);

  useTranscriptionRefresh(() => {
    void load();
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => setElapsed(Date.now() - recording.startedAt), 250);
    return () => window.clearInterval(interval);
  }, [recording]);

  const startRecording = async () => {
    setRecordError(null);
    let noteId: string | null = null;
    try {
      const note = await createNote({
        kind: "audio",
        title: `Aufnahme ${new Date().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`,
      });
      noteId = note.id;

      const recorder = new AudioRecorder();
      await recorder.start({ ownerType: "note", ownerId: note.id });
      recorderRef.current = recorder;
      setRecording({ noteId: note.id, startedAt: Date.now() });
      setElapsed(0);
    } catch (error) {
      setRecordError(String(error));
      if (noteId) await deleteNote(noteId).catch(() => {});
      notify("Aufnahme konnte nicht gestartet werden", "error");
    }
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    const noteId = recording?.noteId ?? null;
    if (!recorder) return;
    try {
      const result = await recorder.stop();
      if (result.truncated) notify("Die Aufnahme wurde unterbrochen und ist unvollständig", "warning");
      setRecording(null);
      recorderRef.current = null;
      await load();
      setOpenNoteId(noteId);
    } catch (error) {
      notify(String(error), "error");
      setRecording(null);
      recorderRef.current = null;
    }
  };

  const saveTextNote = async () => {
    if (!textDraft.trim()) return;
    try {
      await createNote({ kind: "text", body: textDraft });
      setTextDraft("");
      setTextDialogOpen(false);
      await load();
    } catch {
      notify("Notiz konnte nicht gespeichert werden", "error");
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h5" fontWeight={600}>
          Notizen
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControlLabel
            control={<Switch checked={onlyOpen} onChange={(event) => setOnlyOpen(event.target.checked)} />}
            label="Nur offene"
          />
          <Button startIcon={<NoteAdd />} onClick={() => setTextDialogOpen(true)}>
            Text
          </Button>
          <Button variant="contained" startIcon={<Mic />} onClick={startRecording} disabled={Boolean(recording)}>
            Aufnehmen
          </Button>
        </Stack>
      </Stack>

      <TextField
        fullWidth
        size="small"
        placeholder="In Titeln und Transkripten suchen"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        InputProps={{ startAdornment: <Search sx={{ mr: 1, color: "text.secondary" }} /> }}
        sx={{ mb: 2 }}
      />

      {loading && <CircularProgress size={24} />}

      {!loading && notes.length === 0 && (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <GraphicEq sx={{ fontSize: 40, color: "text.secondary" }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Noch keine Notizen. Nimm etwas auf oder schreibe einen Gedanken.
          </Typography>
        </Paper>
      )}

      <Stack spacing={1}>
        {notes.map((note) => (
          <Paper
            key={note.id}
            variant="outlined"
            sx={{ p: 1.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5 }}
            onClick={() => setOpenNoteId(note.id)}
          >
            <Box sx={{ color: "text.secondary", display: "flex" }}>
              {note.kind === "audio" ? <Mic /> : <NoteAdd />}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap>
                {note.title}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(note.createdAt).toLocaleString("de-DE")}
                {note.durationMs ? ` · ${formatDuration(note.durationMs)}` : ""}
              </Typography>
            </Box>
            {note.kind === "audio" && (
              <Chip
                size="small"
                variant="outlined"
                color={STATE_COLOR[note.transcriptState] ?? "default"}
                label={STATE_LABEL[note.transcriptState] ?? note.transcriptState}
              />
            )}
          </Paper>
        ))}
      </Stack>

      <NoteDialog
        noteId={openNoteId}
        onClose={() => setOpenNoteId(null)}
        onChanged={() => void load()}
      />

      <Dialog open={textDialogOpen} onClose={() => setTextDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Neue Text-Notiz</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={6}
            placeholder="Was möchtest du festhalten?"
            value={textDraft}
            onChange={(event) => setTextDraft(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTextDialogOpen(false)}>Abbrechen</Button>
          <Button variant="contained" onClick={saveTextNote} disabled={!textDraft.trim()}>
            Speichern
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(recording)} maxWidth="xs" fullWidth onClose={() => void stopRecording()}>
        <DialogTitle>Aufnahme läuft</DialogTitle>
        <DialogContent>
          <Stack spacing={2} alignItems="center" sx={{ py: 2 }}>
            <Typography variant="h3" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
              {Math.floor(elapsed / 60000)}:{String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0")}
            </Typography>
            <Alert severity="warning" sx={{ width: "100%" }}>
              Dieser Tab muss sichtbar bleiben und der Bildschirm an — sonst beendet der Browser die Aufnahme.
              Bereits übertragene Teile bleiben erhalten.
            </Alert>
            {recordError && <Alert severity="error">{recordError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <IconButton onClick={() => void stopRecording()} color="primary" aria-label="Aufnahme stoppen">
            <Mic />
          </IconButton>
          <Button variant="contained" onClick={() => void stopRecording()}>
            Stoppen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
