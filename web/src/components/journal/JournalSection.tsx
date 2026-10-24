import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  CheckCircle,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Mic as MicIcon,
  RadioButtonUnchecked,
  Stop as StopIcon,
} from "@mui/icons-material";
import {
  archiveQuestion,
  createEntry,
  createQuestion,
  deleteEntry,
  getDay,
  getQuestionHistory,
  listQuestions,
  setAnswer,
  updateEntry,
  updateQuestion,
  type JournalDay,
  type JournalQuestion,
  type QuestionHistory,
} from "../../api/journalApi";
import { RecordingView } from "../audio/RecordingView";
import { DictateButton } from "../audio/DictateButton";
import { AudioRecorder } from "../../audio/recorder";
import { runAllTranscriptionJobs } from "../../asr/transcription";
import { useTranscriptionRefresh } from "../../asr/useTranscriptionRefresh";
import { useNotify } from "../../context/NotifyContext";

interface Props {
  date: string;
}

function timeOf(value: string): string {
  return new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function shortDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export function JournalSection({ date }: Props) {
  const notify = useNotify();
  const [day, setDay] = useState<JournalDay | null>(null);
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [entryDialog, setEntryDialog] = useState<{ id: string | null; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setDay(await getDay(date));
    } catch {
      notify("Tagebuch konnte nicht geladen werden", "error");
    }
  }, [date, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  useTranscriptionRefresh(() => {
    void load();
  });

  const saveEntry = async () => {
    if (!entryDialog) return;
    const text = entryDialog.text.trim();
    if (!text) return;
    try {
      if (entryDialog.id) await updateEntry(entryDialog.id, text);
      else await createEntry(date, text);
      setEntryDialog(null);
      await load();
    } catch {
      notify("Eintrag konnte nicht gespeichert werden", "error");
    }
  };

  const removeEntry = async (id: string) => {
    if (!window.confirm("Eintrag löschen?")) return;
    try {
      await deleteEntry(id);
      await load();
    } catch {
      notify("Eintrag konnte nicht gelöscht werden", "error");
    }
  };

  const answeredCount = day?.questions.filter((question) => (question.answer?.text ?? "").trim().length > 0).length;

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography variant="h6">Tagebuch</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "JetBrains Mono, monospace" }}>
            {answeredCount ?? 0}/{day?.questions.length ?? 0} Fragen
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => setManageOpen(true)}>
            Fragen
          </Button>
          <Button size="small" startIcon={<AddIcon />} onClick={() => setEntryDialog({ id: null, text: "" })}>
            Eintrag
          </Button>
        </Stack>
      </Stack>

      <Stack spacing={1} sx={{ mt: 1.5 }}>
        {day?.questions.map((question) => {
          const answered = (question.answer?.text ?? "").trim().length > 0;
          return (
            <Paper
              key={question.id}
              variant="outlined"
              sx={{ p: 1.25, cursor: "pointer", borderLeft: answered ? "4px solid" : undefined, borderLeftColor: answered ? "success.main" : undefined }}
              onClick={() => setOpenQuestionId(question.id)}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                {answered ? (
                  <CheckCircle fontSize="small" color="success" />
                ) : (
                  <RadioButtonUnchecked fontSize="small" color="disabled" />
                )}
                <Typography variant="subtitle2" sx={{ flex: 1 }}>
                  {question.text}
                </Typography>
                {question.recording && (
                  <Chip size="small" variant="outlined" label="Audio" color={question.recording.segments.length ? "success" : "default"} />
                )}
              </Stack>
              {answered && (
                <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.5, pl: 4 }}>
                  {question.answer?.text}
                </Typography>
              )}
            </Paper>
          );
        })}
      </Stack>

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Einträge
      </Typography>
      <Stack spacing={1}>
        {day?.entries.map((entry) => (
          <Paper key={entry.id} variant="outlined" sx={{ p: 1.25 }}>
            <Stack direction="row" spacing={1}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  {timeOf(entry.createdAt)}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {entry.text}
                </Typography>
                {entry.recordings.map((recording) => (
                  <Box key={recording.id} sx={{ mt: 1 }}>
                    <RecordingView recording={recording} onSaved={() => void load()} />
                  </Box>
                ))}
              </Box>
              <IconButton size="small" onClick={() => setEntryDialog({ id: entry.id, text: entry.text })}>
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => void removeEntry(entry.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Paper>
        ))}
        {day && day.entries.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Noch kein Eintrag für diesen Tag.
          </Typography>
        )}
      </Stack>

      <QuestionDialog
        questionId={openQuestionId}
        date={date}
        onClose={() => setOpenQuestionId(null)}
        onChanged={() => void load()}
      />

      <ManageQuestionsDialog open={manageOpen} onClose={() => setManageOpen(false)} onChanged={() => void load()} />

      <Dialog open={Boolean(entryDialog)} onClose={() => setEntryDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{entryDialog?.id ? "Eintrag bearbeiten" : "Neuer Eintrag"}</DialogTitle>
        <DialogContent>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              autoFocus
              fullWidth
              multiline
              minRows={6}
              value={entryDialog?.text ?? ""}
              onChange={(event) =>
                setEntryDialog((current) => (current ? { ...current, text: event.target.value } : current))
              }
            />
            <DictateButton
              onText={(text) =>
                setEntryDialog((current) =>
                  current ? { ...current, text: current.text ? `${current.text} ${text}` : text } : current
                )
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEntryDialog(null)}>Abbrechen</Button>
          <Button variant="contained" onClick={saveEntry} disabled={!entryDialog?.text.trim()}>
            Speichern
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

interface QuestionDialogProps {
  questionId: string | null;
  date: string;
  onClose: () => void;
  onChanged: () => void;
}

function QuestionDialog({ questionId, date, onClose, onChanged }: QuestionDialogProps) {
  const notify = useNotify();
  const [history, setHistory] = useState<QuestionHistory | null>(null);
  const [text, setText] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<AudioRecorder | null>(null);

  const load = useCallback(async () => {
    if (!questionId) return;
    try {
      const result = await getQuestionHistory(questionId);
      setHistory(result);
      setQuestionText(result.question.text);
      const todays = result.answers.find((answer) => answer.answerDate === date);
      setText(todays?.text ?? "");
    } catch {
      notify("Frage konnte nicht geladen werden", "error");
    }
  }, [questionId, date, notify]);

  useEffect(() => {
    if (questionId) {
      setHistory(null);
      void load();
    }
  }, [questionId, load]);

  const save = async () => {
    if (!questionId) return;
    setSaving(true);
    try {
      await setAnswer(questionId, date, text);
      onChanged();
      await load();
      notify("Antwort gespeichert");
    } catch {
      notify("Antwort konnte nicht gespeichert werden", "error");
    }
    setSaving(false);
  };

  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => setElapsed((value) => value + 250), 250);
    return () => window.clearInterval(interval);
  }, [recording]);

  useEffect(() => {
    return () => {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
    };
  }, []);

  const startDictation = async () => {
    if (!questionId) return;
    try {
      const saved = await setAnswer(questionId, date, text);
      if (!saved.answer) return;
      const recorder = new AudioRecorder();
      await recorder.start({ ownerType: "journal_answer", ownerId: saved.answer.id });
      recorderRef.current = recorder;
      setElapsed(0);
      setRecording(true);
    } catch (error) {
      notify(`Aufnahme fehlgeschlagen: ${String(error)}`, "error");
    }
  };

  const stopDictation = async () => {
    const recorder = recorderRef.current;
    if (!recorder || !questionId) return;
    setBusy(true);
    try {
      await recorder.stop();
      recorderRef.current = null;
      setRecording(false);

      try {
        await runAllTranscriptionJobs();
      } catch {
        notify("Transkription nicht möglich – Modell in den Einstellungen einrichten", "warning");
      }

      const updated = await getQuestionHistory(questionId);
      const current = updated.answers.find((answer) => answer.answerDate === date);
      const transcript = (current?.recording?.segments ?? []).map((segment) => segment.text).join(" ").trim();
      if (transcript) {
        setText(transcript);
        await setAnswer(questionId, date, transcript);
        onChanged();
      }
      await load();
    } catch (error) {
      notify(String(error), "error");
    }
    setBusy(false);
  };

  const rename = async () => {
    if (!questionId || !questionText.trim() || questionText === history?.question.text) return;
    try {
      await updateQuestion(questionId, { text: questionText });
      onChanged();
      await load();
    } catch {
      notify("Frage konnte nicht geändert werden", "error");
    }
  };

  const archive = async () => {
    if (!questionId) return;
    if (!window.confirm("Frage archivieren? Die bisherigen Antworten bleiben erhalten.")) return;
    try {
      await archiveQuestion(questionId);
      onChanged();
      onClose();
    } catch {
      notify("Frage konnte nicht archiviert werden", "error");
    }
  };

  return (
    <Dialog open={Boolean(questionId)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Frage</DialogTitle>
      <DialogContent>
        {!history && <Typography variant="body2">Lädt…</Typography>}
        {history && (
          <Stack spacing={2}>
            <TextField
              label="Frage"
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
              onBlur={rename}
              fullWidth
            />

            <TextField
              label={`Antwort vom ${shortDate(date)}`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              multiline
              minRows={4}
              fullWidth
            />

            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              {recording ? (
                <>
                  <Chip color="error" size="small" label={`Aufnahme läuft · ${Math.floor(elapsed / 1000)} s`} />
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<StopIcon />}
                    onClick={stopDictation}
                    disabled={busy}
                  >
                    Stoppen und transkribieren
                  </Button>
                </>
              ) : (
                <Button size="small" startIcon={<MicIcon />} onClick={startDictation} disabled={busy}>
                  Diktieren
                </Button>
              )}
              {busy && (
                <Typography variant="caption" color="text.secondary">
                  Transkription läuft…
                </Typography>
              )}
            </Stack>

            <Stack direction="row" spacing={1}>
              <Chip size="small" variant="outlined" label={`${history.stats.answeredDays} beantwortet`} />
              <Chip
                size="small"
                variant="outlined"
                color={history.stats.streak > 0 ? "success" : "default"}
                label={`Serie: ${history.stats.streak}`}
              />
            </Stack>

            <Divider />
            <Typography variant="subtitle2">Verlauf</Typography>
            <Stack spacing={1} sx={{ maxHeight: 240, overflowY: "auto" }}>
              {history.answers.map((answer) => (
                <Box key={answer.id}>
                  <Typography variant="caption" color="text.secondary">
                    {shortDate(answer.answerDate)}
                  </Typography>
                  <Typography variant="body2">{answer.text || "—"}</Typography>
                  {answer.recording && (
                    <Box sx={{ mt: 0.5 }}>
                      <RecordingView recording={answer.recording} onSaved={() => void load()} />
                    </Box>
                  )}
                </Box>
              ))}
              {history.answers.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  Noch keine Antworten.
                </Typography>
              )}
            </Stack>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="error" onClick={archive}>
          Archivieren
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Schließen</Button>
        <Button variant="contained" onClick={save} disabled={saving || !history}>
          Speichern
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface ManageProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function ManageQuestionsDialog({ open, onClose, onChanged }: ManageProps) {
  const notify = useNotify();
  const [questions, setQuestions] = useState<JournalQuestion[]>([]);
  const [newText, setNewText] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await listQuestions();
      setQuestions(result.questions);
    } catch {
      notify("Fragen konnten nicht geladen werden", "error");
    }
  }, [notify]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const add = async () => {
    if (!newText.trim()) return;
    try {
      await createQuestion(newText.trim());
      setNewText("");
      await load();
      onChanged();
    } catch {
      notify("Frage konnte nicht angelegt werden", "error");
    }
  };

  const rename = async (question: JournalQuestion, text: string) => {
    if (!text.trim() || text === question.text) return;
    try {
      await updateQuestion(question.id, { text });
      await load();
      onChanged();
    } catch {
      notify("Frage konnte nicht geändert werden", "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Fragen bearbeiten</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {questions.map((question) => (
            <Stack key={question.id} direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                fullWidth
                defaultValue={question.text}
                onBlur={(event) => void rename(question, event.target.value)}
                disabled={Boolean(question.archivedAt)}
              />
              {question.archivedAt ? (
                <Chip size="small" label="archiviert" />
              ) : (
                <IconButton
                  size="small"
                  onClick={async () => {
                    if (!window.confirm("Frage archivieren?")) return;
                    await archiveQuestion(question.id);
                    await load();
                    onChanged();
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              )}
            </Stack>
          ))}

          <Divider />
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              placeholder="Neue Frage"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void add();
              }}
            />
            <Button variant="contained" onClick={add} disabled={!newText.trim()}>
              Hinzufügen
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Schließen</Button>
      </DialogActions>
    </Dialog>
  );
}
