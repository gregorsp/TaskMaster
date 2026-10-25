import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { Check, Close, ContentCopy, Edit as EditIcon, Pause, PlayArrow } from "@mui/icons-material";
import { getPlaybackUrl, putSegments, retryJob, type NoteRecording } from "../../api/notesApi";
import { useNotify } from "../../context/NotifyContext";

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Fließtext statt einer Zeile pro Segment: Segmente werden zu Absätzen
 * zusammengezogen. Auch alte Aufnahmen mit wortweisen Segmenten lesen sich
 * dadurch wie Text.
 */
function toParagraphs(segments: Array<{ text: string }>): string[] {
  const paragraphs: string[] = [];
  let current = "";
  let sentences = 0;

  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    current = current ? `${current} ${text}` : text;
    if (/[.!?…]$/.test(text)) sentences += 1;

    if (current.length >= 420 || sentences >= 4) {
      paragraphs.push(current);
      current = "";
      sentences = 0;
    }
  }

  if (current) paragraphs.push(current);
  return paragraphs;
}

interface Props {
  recording: NoteRecording;
  onSaved?: () => void;
}

/**
 * Gemeinsamer Baustein für jede Aufnahme: Player, Textansicht und
 * Segment-Korrektur. Notizen und Meditations-Sessions nutzen ihn identisch —
 * nur die Hülle drumherum unterscheidet sich.
 */
export function RecordingView({ recording, onSaved }: Props) {
  const notify = useNotify();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"text" | "transcript">("text");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [segments, setSegments] = useState(recording.segments);

  useEffect(() => {
    setSegments(recording.segments);
  }, [recording.segments]);

  useEffect(() => {
    let cancelled = false;
    getPlaybackUrl(recording.id)
      .then((result) => {
        if (!cancelled) setUrl(result.url);
      })
      .catch(() => {
        if (!cancelled) setError("Audio konnte nicht geladen werden");
      });
    return () => {
      cancelled = true;
    };
  }, [recording.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrentMs(audio.currentTime * 1000);
    const onEnded = () => {
      setPlaying(false);
      setCurrentMs(0);
      audio.currentTime = 0;
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [url]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const seek = (ms: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    setCurrentMs(ms);
  };

  const startEdit = (segmentId: string, text: string) => {
    setEditingId(segmentId);
    setDraft(text);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const next = segments.map((segment) =>
        segment.id === editingId ? { ...segment, text: draft.trim() } : segment
      );
      const result = await putSegments(
        recording.id,
        next.map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs, text: segment.text }))
      );
      setSegments(result.segments);
      setEditingId(null);
      onSaved?.();
    } catch {
      notify("Korrektur konnte nicht gespeichert werden", "error");
    }
    setSaving(false);
  };

  const copyText = async () => {
    const text = segments.map((segment) => segment.text).join(" ");
    try {
      await navigator.clipboard.writeText(text);
      notify("Text kopiert");
    } catch {
      notify("Kopieren nicht möglich", "error");
    }
  };

  const activeIndex = segments.findIndex(
    (segment) => currentMs >= segment.startMs && currentMs <= segment.endMs
  );
  const totalMs = recording.durationMs || 0;
  const progress = totalMs > 0 ? Math.min(100, (currentMs / totalMs) * 100) : 0;

  if (error) {
    return (
      <Typography variant="body2" color="error">
        {error}
      </Typography>
    );
  }

  return (
    <Box>
      {url && <audio ref={audioRef} src={url} preload="metadata" />}

      <Stack direction="row" spacing={1} alignItems="center">
        <IconButton onClick={toggle} disabled={!url} aria-label={playing ? "Pause" : "Abspielen"}>
          {playing ? <Pause /> : <PlayArrow />}
        </IconButton>
        <Box
          sx={{ flex: 1, height: 6, bgcolor: "action.hover", borderRadius: 3, cursor: url ? "pointer" : "default" }}
          onClick={(event) => {
            if (!url || totalMs <= 0) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - rect.left) / rect.width;
            seek(Math.max(0, Math.min(totalMs, ratio * totalMs)));
          }}
        >
          <Box sx={{ width: `${progress}%`, height: "100%", bgcolor: "primary.main", borderRadius: 3 }} />
        </Box>
        <Typography variant="caption" sx={{ fontFamily: "JetBrains Mono, monospace", minWidth: 84 }}>
          {formatMs(currentMs)} / {formatMs(totalMs)}
        </Typography>
      </Stack>

      {recording.job?.status === "failed" && (
        <Alert
          severity="error"
          sx={{ mt: 1 }}
          action={
            <Button
              size="small"
              color="inherit"
              onClick={async () => {
                if (!recording.job) return;
                await retryJob(recording.job.id);
                notify("Transkription erneut eingeplant");
                onSaved?.();
              }}
            >
              Erneut versuchen
            </Button>
          }
        >
          Transkription fehlgeschlagen{recording.job.error ? `: ${recording.job.error}` : ""}
        </Alert>
      )}

      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mt: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_event, next: "text" | "transcript" | null) => next && setMode(next)}
        >
          <ToggleButton value="text">Text</ToggleButton>
          <ToggleButton value="transcript">Transkript</ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="Text kopieren">
          <span>
            <IconButton size="small" onClick={copyText} disabled={segments.length === 0}>
              <ContentCopy fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {segments.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Noch kein Transkript.
        </Typography>
      )}

      {mode === "text" && segments.length > 0 && (
        <Box sx={{ mt: 1 }}>
          {toParagraphs(segments).map((paragraph, index) => (
            <Typography key={index} variant="body1" sx={{ lineHeight: 1.7, mb: 1.5 }}>
              {paragraph}
            </Typography>
          ))}
        </Box>
      )}

      {mode === "transcript" && segments.length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 1, maxHeight: 320, overflowY: "auto" }}>
          {segments.map((segment, index) => (
            <Paper
              key={segment.id}
              variant="outlined"
              sx={{
                px: 1,
                py: 0.5,
                bgcolor: index === activeIndex ? "action.selected" : undefined,
                borderColor: index === activeIndex ? "primary.main" : undefined,
              }}
            >
              {editingId === segment.id ? (
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <TextField
                    autoFocus
                    fullWidth
                    size="small"
                    multiline
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void saveEdit();
                      } else if (event.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                  />
                  <IconButton size="small" onClick={() => void saveEdit()} disabled={saving} aria-label="Speichern">
                    <Check fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => setEditingId(null)} aria-label="Abbrechen">
                    <Close fontSize="small" />
                  </IconButton>
                </Stack>
              ) : (
                <Stack direction="row" spacing={1} alignItems="baseline">
                  <Button
                    size="small"
                    onClick={() => seek(segment.startMs)}
                    sx={{ minWidth: 0, px: 0.5, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
                  >
                    {formatMs(segment.startMs)}
                  </Button>
                  <Typography variant="body2" sx={{ flex: 1, cursor: "text" }} onClick={() => startEdit(segment.id, segment.text)}>
                    {segment.text}
                  </Typography>
                  <IconButton size="small" onClick={() => startEdit(segment.id, segment.text)} aria-label="Segment bearbeiten">
                    <EditIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                  {index === activeIndex && <Chip size="small" label="läuft" color="primary" variant="outlined" />}
                </Stack>
              )}
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
}
