import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { PlayArrow as PlayArrowIcon } from "@mui/icons-material";
import { useNotify } from "../../context/NotifyContext";
import {
  getServerTranscriptionStatus,
  startServerTranscription,
  type ServerRunSummary,
  type ServerTranscriptionStatus,
} from "../../api/transcriptionServerApi";

const REFRESH_MS = 30_000;

function formatDateTime(iso: string | null): string {
  if (!iso) return "–";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1_048_576)} MB`;
}

function describeRun(run: ServerRunSummary): string {
  const parts = [`${run.processed} transkribiert`];
  if (run.failed > 0) parts.push(`${run.failed} fehlgeschlagen`);
  if (run.skipped) parts.push(`übersprungen (${run.skipped})`);
  if (run.stoppedBy) parts.push(`gestoppt: ${run.stoppedBy}`);
  return parts.join(", ");
}

/**
 * Admin-Block in den Einstellungen: Zustand des nächtlichen Server-Laufs.
 * An/Aus bleibt eine Env-Variable – hier wird nur gezeigt und manuell gestartet.
 */
export function ServerTranscriptionPanel() {
  const notify = useNotify();
  const [status, setStatus] = useState<ServerTranscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await getServerTranscriptionStatus());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status konnte nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await startServerTranscription();
      notify("Transkription gestartet", "success");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Start fehlgeschlagen", "error");
    } finally {
      setStarting(false);
    }
  };

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} mb={1}>
        <Typography variant="h6">Transkription auf dem Server</Typography>
        {status && (
          <Stack direction="row" spacing={1} alignItems="center">
            {status.running && <CircularProgress size={16} />}
            <Chip
              size="small"
              label={status.enabled ? (status.running ? "läuft" : "aktiv") : "aus"}
              color={status.enabled ? "success" : "default"}
              variant="outlined"
            />
          </Stack>
        )}
      </Stack>

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
        Nachts transkribiert der Server selbst: alles, was offen ist, und alles, was seit zehn Minuten keinen
        Fortschritt mehr meldet. Dieselbe Aufnahme kann nicht gleichzeitig auf einem Gerät und auf dem Server laufen –
        wer den Job zuerst hat, schreibt das Ergebnis. Nur Opus-Aufnahmen (Chrome, Firefox, Android); Safari-Aufnahmen
        bleiben bei der Transkription im Browser.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading && !status && (
        <Stack alignItems="center" py={2}>
          <CircularProgress size={24} />
        </Stack>
      )}

      {status && (
        <>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Chip size="small" variant="outlined" label={`Zeitplan: täglich ${status.schedule.at} (${status.schedule.timeZone})`} />
            <Chip size="small" variant="outlined" label={`Nächster Lauf: ${formatDateTime(status.schedule.nextRunAt)}`} />
            <Chip
              size="small"
              variant="outlined"
              label={`Warteschlange: ${status.queue.pending} offen · ${status.queue.running} hängend · ${status.queue.failed} fehlgeschlagen`}
            />
            <Chip
              size="small"
              variant="outlined"
              color={status.model.present ? "success" : "warning"}
              label={
                status.model.present
                  ? `Modell vorhanden (${formatBytes(status.model.bytes)})${status.model.loaded ? ", geladen" : ""}`
                  : `Modell fehlt (${formatBytes(status.model.totalBytes)} Download beim ersten Lauf)`
              }
            />
          </Stack>

          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlayArrowIcon />}
              onClick={() => void handleStart()}
              loading={starting}
              disabled={!status.enabled || status.running}
            >
              Jetzt starten
            </Button>
            {!status.enabled && (
              <Typography variant="caption" color="text.secondary">
                Aus. Einschalten mit <code>TRANSCRIBE_SERVER=true</code> und Neustart des Containers.
              </Typography>
            )}
          </Stack>

          {status.lastRun && (
            <Typography variant="body2" sx={{ mb: 1 }}>
              Letzter Lauf: {formatDateTime(status.lastRun.startedAt)} – {describeRun(status.lastRun)}
            </Typography>
          )}

          {status.jobs.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Offene und fehlgeschlagene Aufträge
              </Typography>
              <Stack spacing={0.5}>
                {status.jobs.slice(0, 10).map((job) => (
                  <Box key={job.id} sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "baseline" }}>
                    <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                      {job.recordingId.slice(0, 8)}
                    </Typography>
                    <Chip size="small" label={job.status} variant="outlined" />
                    <Typography variant="caption" color="text.secondary">
                      {Math.round(job.durationMs / 1000)} s · {job.attempts} Versuche · zuletzt {formatDateTime(job.updatedAt)}
                    </Typography>
                    {job.error && (
                      <Typography variant="caption" color="error.main">
                        {job.error}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            </>
          )}

          {status.runs.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Verlauf
              </Typography>
              <Stack spacing={0.25}>
                {status.runs.map((run) => (
                  <Typography key={run.startedAt} variant="caption" color="text.secondary">
                    {formatDateTime(run.startedAt)} · {run.triggeredBy} · {describeRun(run)}
                  </Typography>
                ))}
              </Stack>
            </>
          )}
        </>
      )}
    </Paper>
  );
}
