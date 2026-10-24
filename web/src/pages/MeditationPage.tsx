import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { Delete as DeleteIcon, SelfImprovement, Star, StarBorder } from "@mui/icons-material";
import {
  addComment,
  createSession,
  deleteComment,
  deleteSession,
  listSessions,
  updateSession,
  type MeditationSession,
  type MeditationStats,
} from "../api/meditationApi";
import { AudioRecorder } from "../audio/recorder";
import { RecordingView } from "../components/audio/RecordingView";
import { DictateButton } from "../components/audio/DictateButton";
import { useTranscriptionRefresh } from "../asr/useTranscriptionRefresh";
import { useNotify } from "../context/NotifyContext";

const PRESETS = [5, 10, 15, 20, 30];
const INTERVAL_GONG_MINUTES = 5;

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function playChime(context: AudioContext | null, times = 1): void {
  if (!context) return;
  for (let index = 0; index < times; index++) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 528;
    oscillator.connect(gain);
    gain.connect(context.destination);
    const start = context.currentTime + index * 0.7;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
    oscillator.start(start);
    oscillator.stop(start + 0.6);
  }
}

function RatingStars({ value, onChange }: { value: number | null; onChange?: (value: number) => void }) {
  return (
    <Stack direction="row" spacing={0.25} alignItems="center">
      {[1, 2, 3, 4, 5].map((level) => (
        <IconButton
          key={level}
          size="small"
          disabled={!onChange}
          onClick={() => onChange?.(level)}
          aria-label={`Konzentration ${level}`}
        >
          {value !== null && level <= value ? (
            <Star fontSize="small" color="warning" />
          ) : (
            <StarBorder fontSize="small" />
          )}
        </IconButton>
      ))}
    </Stack>
  );
}

export function MeditationPage() {
  const notify = useNotify();
  const [sessions, setSessions] = useState<MeditationSession[]>([]);
  const [stats, setStats] = useState<MeditationStats | null>(null);
  const [plannedSec, setPlannedSec] = useState<number | null>(600);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [note, setNote] = useState("");
  const [withRecording, setWithRecording] = useState(false);
  const [intervalGong, setIntervalGong] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMinutes, setManualMinutes] = useState("10");
  const [manualNote, setManualNote] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ratingTarget, setRatingTarget] = useState<string | null>(null);

  const startedAtRef = useRef<number | null>(null);
  const pausedMsRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastGongRef = useRef(0);
  const finishingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await listSessions(100);
      setSessions(result.sessions);
      setStats(result.stats);
    } catch {
      notify("Meditationen konnten nicht geladen werden", "error");
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  useTranscriptionRefresh(() => {
    void load();
  });

  const finish = useCallback(
    async (completed: boolean) => {
      if (finishingRef.current) return;
      finishingRef.current = true;

      const elapsed = startedAtRef.current ? Date.now() - startedAtRef.current : pausedMsRef.current;
      const sessionId = sessionIdRef.current;
      const durationSec = Math.round(elapsed / 1000);

      setRunning(false);
      setPaused(false);
      pausedMsRef.current = 0;
      startedAtRef.current = null;

      if (completed) playChime(audioContextRef.current, 3);

      try {
        if (sessionId) {
          await updateSession(sessionId, {
            endedAt: new Date().toISOString(),
            actualDurationSec: durationSec,
            note: note.trim() || null,
          });
        }
        if (recorderRef.current) {
          await recorderRef.current.stop().catch(() => {});
          recorderRef.current = null;
        }
      } catch {
        notify("Session konnte nicht gespeichert werden", "error");
      }

      sessionIdRef.current = null;
      setNote("");
      await load();
      if (sessionId) setRatingTarget(sessionId);
      finishingRef.current = false;
    },
    [load, note, notify]
  );

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      if (!startedAtRef.current) return;
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);

      if (intervalGong) {
        const minutes = Math.floor(elapsed / 60000);
        if (minutes > 0 && minutes % INTERVAL_GONG_MINUTES === 0 && minutes !== lastGongRef.current) {
          lastGongRef.current = minutes;
          playChime(audioContextRef.current, 1);
        }
      }

      if (plannedSec && elapsed >= plannedSec * 1000) {
        void finish(true);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [running, plannedSec, intervalGong, finish]);

  const start = async () => {
    try {
      audioContextRef.current = new AudioContext();
      await audioContextRef.current.resume().catch(() => {});
      lastGongRef.current = 0;

      const session = await createSession({
        startedAt: new Date().toISOString(),
        plannedDurationSec: plannedSec,
      });
      sessionIdRef.current = session.id;

      if (withRecording) {
        const recorder = new AudioRecorder();
        await recorder.start({ ownerType: "meditation_session", ownerId: session.id });
        recorderRef.current = recorder;
      }

      startedAtRef.current = Date.now();
      pausedMsRef.current = 0;
      setElapsedMs(0);
      setRunning(true);
      setPaused(false);
    } catch (error) {
      notify(`Start fehlgeschlagen: ${String(error)}`, "error");
    }
  };

  const pause = () => {
    if (!startedAtRef.current) return;
    pausedMsRef.current = Date.now() - startedAtRef.current;
    startedAtRef.current = null;
    setPaused(true);
  };

  const resume = () => {
    startedAtRef.current = Date.now() - pausedMsRef.current;
    setPaused(false);
  };

  const remainingMs = plannedSec ? Math.max(0, plannedSec * 1000 - elapsedMs) : null;
  const displayMs = remainingMs ?? elapsedMs;

  const manualCreate = async () => {
    const minutes = Number(manualMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    try {
      const startedAt = new Date(Date.now() - minutes * 60000);
      await createSession({
        startedAt: startedAt.toISOString(),
        actualDurationSec: Math.round(minutes * 60),
        note: manualNote.trim() || null,
      });
      setManualOpen(false);
      setManualMinutes("10");
      setManualNote("");
      await load();
    } catch {
      notify("Session konnte nicht angelegt werden", "error");
    }
  };

  const selected = sessions.find((session) => session.id === selectedId) ?? null;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h5" fontWeight={600}>
          Meditation
        </Typography>
        <Button onClick={() => setManualOpen(true)}>Session nachtragen</Button>
      </Stack>

      {stats && (
        <Stack direction="row" spacing={1} flexWrap="wrap" mb={2}>
          <Chip variant="outlined" label={`Woche: ${stats.weekMinutes} min`} />
          <Chip variant="outlined" label={`Monat: ${stats.monthMinutes} min`} />
          <Chip variant="outlined" label={`Gesamt: ${stats.totalMinutes} min`} />
          <Chip
            variant="outlined"
            color={stats.streak > 0 ? "success" : "default"}
            label={`Serie: ${stats.streak} Tage`}
          />
          {stats.avgConcentration !== null && (
            <Chip variant="outlined" color="warning" label={`Ø Konzentration: ${stats.avgConcentration} (30 Tage)`} />
          )}
        </Stack>
      )}

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
        <Paper variant="outlined" sx={{ p: 3, width: { xs: "100%", md: 380 }, textAlign: "center" }}>
          <SelfImprovement sx={{ fontSize: 40, color: "text.secondary" }} />
          <Typography variant="h2" sx={{ fontFamily: "JetBrains Mono, monospace", my: 1 }}>
            {formatClock(displayMs)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {plannedSec ? (remainingMs === 0 ? "Zeit erreicht" : "verbleibend") : "vergangen"}
          </Typography>

          {!running ? (
            <>
              <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" sx={{ mt: 2 }}>
                {PRESETS.map((minutes) => (
                  <Chip
                    key={minutes}
                    label={`${minutes} min`}
                    color={plannedSec === minutes * 60 ? "primary" : "default"}
                    variant={plannedSec === minutes * 60 ? "filled" : "outlined"}
                    onClick={() => setPlannedSec(minutes * 60)}
                  />
                ))}
                <Chip
                  label="offen"
                  color={plannedSec === null ? "primary" : "default"}
                  variant={plannedSec === null ? "filled" : "outlined"}
                  onClick={() => setPlannedSec(null)}
                />
              </Stack>
              <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 2 }}>
                <FormControlLabel
                  control={<Switch checked={withRecording} onChange={(event) => setWithRecording(event.target.checked)} />}
                  label="Aufnehmen"
                />
                <FormControlLabel
                  control={<Switch checked={intervalGong} onChange={(event) => setIntervalGong(event.target.checked)} />}
                  label="Gong alle 5 min"
                />
              </Stack>
              <Button variant="contained" size="large" sx={{ mt: 2 }} onClick={start}>
                Starten
              </Button>
            </>
          ) : (
            <>
              <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 2 }}>
                {paused ? (
                  <Button variant="contained" onClick={resume}>
                    Weiter
                  </Button>
                ) : (
                  <Button variant="outlined" onClick={pause}>
                    Pause
                  </Button>
                )}
                <Button variant="contained" color="success" onClick={() => void finish(false)}>
                  Beenden
                </Button>
              </Stack>
              <TextField
                label="Notiz zur Session"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                fullWidth
                multiline
                minRows={2}
                sx={{ mt: 2 }}
              />
              <Alert severity="info" sx={{ mt: 2, textAlign: "left" }}>
                Bildschirm an und Tab sichtbar lassen — sonst endet eine laufende Aufnahme.
              </Alert>
            </>
          )}
        </Paper>

        <Box sx={{ flex: 1, minWidth: 0, width: "100%" }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Sessions
          </Typography>
          <Stack spacing={1}>
            {sessions.map((session) => (
              <Paper
                key={session.id}
                variant="outlined"
                sx={{ p: 1.5, cursor: "pointer" }}
                onClick={() => setSelectedId(session.id)}
              >
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2">
                      {new Date(session.startedAt).toLocaleString("de-DE")} ·{" "}
                      {Math.round(session.actualDurationSec / 60)} min
                      {session.plannedDurationSec
                        ? ` von ${Math.round(session.plannedDurationSec / 60)} min`
                        : ""}
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <RatingStars value={session.concentration} />
                      {session.recordings.length > 0 && (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={
                            session.recordings.some((recording) => recording.segments.length > 0)
                              ? "Transkript"
                              : "Audio"
                          }
                        />
                      )}
                      {session.comments.length > 0 && (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`${session.comments.length} Kommentar${session.comments.length === 1 ? "" : "e"}`}
                        />
                      )}
                    </Stack>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={async (event) => {
                      event.stopPropagation();
                      if (!window.confirm("Session löschen?")) return;
                      await deleteSession(session.id);
                      await load();
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Paper>
            ))}
            {sessions.length === 0 && (
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Typography color="text.secondary" textAlign="center">
                  Noch keine Meditation erfasst.
                </Typography>
              </Paper>
            )}
          </Stack>
        </Box>
      </Stack>

      {selected && (
        <SessionDialog session={selected} onClose={() => setSelectedId(null)} onChanged={() => void load()} />
      )}

      <Dialog open={Boolean(ratingTarget)} onClose={() => setRatingTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Wie konzentriert warst du?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} alignItems="center" sx={{ py: 1 }}>
            <RatingStars
              value={null}
              onChange={async (value) => {
                if (!ratingTarget) return;
                await updateSession(ratingTarget, { concentration: value });
                setRatingTarget(null);
                await load();
              }}
            />
            <Typography variant="caption" color="text.secondary">
              Optional — du kannst sie später in der Session-Karte ändern.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRatingTarget(null)}>Überspringen</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={manualOpen} onClose={() => setManualOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Session nachtragen</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Dauer in Minuten"
              type="number"
              value={manualMinutes}
              onChange={(event) => setManualMinutes(event.target.value)}
              fullWidth
            />
            <TextField
              label="Notiz"
              value={manualNote}
              onChange={(event) => setManualNote(event.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualOpen(false)}>Abbrechen</Button>
          <Button variant="contained" onClick={manualCreate}>
            Speichern
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface SessionDialogProps {
  session: MeditationSession;
  onClose: () => void;
  onChanged: () => void;
}

function SessionDialog({ session, onClose, onChanged }: SessionDialogProps) {
  const notify = useNotify();
  const [commentText, setCommentText] = useState("");
  const [busy, setBusy] = useState(false);

  const addNewComment = async () => {
    if (!commentText.trim()) return;
    setBusy(true);
    try {
      await addComment(session.id, commentText);
      setCommentText("");
      onChanged();
    } catch {
      notify("Kommentar konnte nicht gespeichert werden", "error");
    }
    setBusy(false);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {new Date(session.startedAt).toLocaleString("de-DE")} · {Math.round(session.actualDurationSec / 60)} min
      </DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Konzentration
          </Typography>
          <RatingStars
            value={session.concentration}
            onChange={async (value) => {
              await updateSession(session.id, { concentration: value });
              onChanged();
            }}
          />
        </Stack>

        {session.recordings.length > 0 ? (
          <Stack spacing={2}>
            {session.recordings.map((recording) => (
              <RecordingView key={recording.id} recording={recording} onSaved={onChanged} />
            ))}
          </Stack>
        ) : session.note ? (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {session.note}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Keine Aufnahme und keine Notiz.
          </Typography>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Kommentare
        </Typography>
        <Stack spacing={1}>
          {session.comments.map((comment) => (
            <Paper key={comment.id} variant="outlined" sx={{ p: 1 }}>
              <Stack direction="row" spacing={1}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(comment.createdAt).toLocaleString("de-DE")}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {comment.text}
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  onClick={async () => {
                    await deleteComment(session.id, comment.id);
                    onChanged();
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Paper>
          ))}
          {session.comments.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Noch keine Kommentare.
            </Typography>
          )}
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              placeholder="Kommentar hinzufügen"
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void addNewComment();
                }
              }}
            />
            <Button variant="contained" onClick={addNewComment} disabled={busy || !commentText.trim()}>
              Hinzufügen
            </Button>
            <DictateButton
              onText={(text) => setCommentText((current) => (current ? `${current} ${text}` : text))}
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Schließen</Button>
      </DialogActions>
    </Dialog>
  );
}
