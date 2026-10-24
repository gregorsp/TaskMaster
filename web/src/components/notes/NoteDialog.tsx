import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { deleteNote, getNote, updateNote, type NoteDetail } from "../../api/notesApi";
import { RecordingView } from "../audio/RecordingView";
import { TranscribeControl } from "./TranscribeControl";
import { useNotify } from "../../context/NotifyContext";
import { useTranscriptionRefresh } from "../../asr/useTranscriptionRefresh";

interface Props {
  noteId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

const STATE_LABEL: Record<string, string> = {
  none: "kein Transkript",
  pending: "wartet auf Gerät",
  running: "läuft",
  done: "transkribiert",
  failed: "fehlgeschlagen",
};

export function NoteDialog({ noteId, onClose, onChanged }: Props) {
  const notify = useNotify();
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!noteId) return;
    try {
      const detail = await getNote(noteId);
      setNote(detail);
      setTitle(detail.title);
      setBody(detail.body ?? "");
      setError(null);
    } catch {
      setError("Notiz konnte nicht geladen werden");
    }
  };

  useEffect(() => {
    if (noteId) {
      setNote(null);
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  useTranscriptionRefresh(() => {
    void load();
  });

  const save = async () => {
    if (!note) return;
    setSaving(true);
    try {
      await updateNote(note.id, { title, body: note.kind === "text" ? body : undefined });
      notify("Notiz gespeichert");
      onChanged();
      await load();
    } catch {
      notify("Speichern fehlgeschlagen", "error");
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!note) return;
    if (!window.confirm("Notiz mit Aufnahme und Transkript löschen?")) return;
    try {
      await deleteNote(note.id);
      notify("Notiz gelöscht");
      onChanged();
      onClose();
    } catch {
      notify("Löschen fehlgeschlagen", "error");
    }
  };

  const transcriptState = note?.recordings.some((recording) => recording.job?.status === "running")
    ? "running"
    : note?.recordings.every((recording) => recording.segments.length > 0)
      ? "done"
      : note?.recordings.some((recording) => recording.job?.status === "failed")
        ? "failed"
        : "pending";

  return (
    <Dialog open={Boolean(noteId)} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Notiz</Typography>
          <Chip
            size="small"
            label={STATE_LABEL[transcriptState ?? "none"]}
            color={transcriptState === "done" ? "success" : transcriptState === "failed" ? "error" : "default"}
          />
        </Stack>
      </DialogTitle>
      <DialogContent>
        {error && <Typography color="error">{error}</Typography>}
        {!note && !error && <Typography variant="body2">Lädt…</Typography>}

        {note && (
          <Stack spacing={2}>
            <TextField label="Titel" value={title} onChange={(event) => setTitle(event.target.value)} fullWidth />

            {note.kind === "text" ? (
              <TextField
                label="Text"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                multiline
                minRows={8}
                fullWidth
              />
            ) : (
              note.recordings.map((recording, index) => (
                <Box key={recording.id}>
                  {index > 0 && <Divider sx={{ mb: 2 }} />}
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="subtitle2">Aufnahme {index + 1}</Typography>
                    <Chip size="small" variant="outlined" label={recording.status} />
                    {recording.job?.error && (
                      <Typography variant="caption" color="error">
                        {recording.job.error}
                      </Typography>
                    )}
                  </Stack>
                  <RecordingView
                    recording={recording}
                    onSaved={async () => {
                      await load();
                      onChanged();
                    }}
                  />
                </Box>
              ))
            )}

            {note.kind === "audio" && (
              <>
                <Divider />
                <TranscribeControl
                  onDone={async () => {
                    await load();
                    onChanged();
                  }}
                />
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="error" onClick={remove} disabled={!note}>
          Löschen
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Schließen</Button>
        <Button variant="contained" onClick={save} disabled={!note || saving}>
          Speichern
        </Button>
      </DialogActions>
    </Dialog>
  );
}
