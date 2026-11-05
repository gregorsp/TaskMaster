import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { OpenInNew as OpenIcon, Replay as ReplayIcon } from "@mui/icons-material";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../context/NotifyContext";
import {
  getAudioOverview,
  requeueFailedJobs,
  type AudioJob,
  type AudioOverview,
  type AudioScope,
} from "../api/audioApi";
import { retryJob } from "../api/notesApi";
import { AudioStatsPanel } from "../components/stats/AudioStatsPanel";
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatEta,
  formatDay,
  formatPercent,
  formatRate,
} from "../utils/format";

const ACTIVE_REFRESH_MS = 3_000;
const IDLE_REFRESH_MS = 20_000;

const STATUS_LABEL: Record<string, string> = {
  pending: "wartet",
  claimed: "übernommen",
  running: "läuft",
  done: "fertig",
  failed: "Fehler",
};

function jobTitle(job: AudioJob): string {
  switch (job.ownerType) {
    case "note":
      return job.ownerTitle ? `Notiz · ${job.ownerTitle}` : "Notiz";
    case "journal_entry":
      return `Journal · ${formatDay(job.ownerDate)}`;
    case "journal_answer":
      return `Journalfrage · ${formatDay(job.ownerDate)}${job.ownerTitle ? ` – ${job.ownerTitle}` : ""}`;
    case "meditation_session":
      return `Meditation · ${formatDay(job.ownerDate)}`;
    default:
      return job.ownerType;
  }
}

function JobRow({
  job,
  isOwn,
  showUser,
  onOpen,
  onRetry,
  retrying,
}: {
  job: AudioJob;
  isOwn: boolean;
  showUser: boolean;
  onOpen: (path: string) => void;
  onRetry: (job: AudioJob) => void;
  retrying: boolean;
}) {
  const finished = job.finishedAt ?? (job.status === "done" ? job.updatedAt : null);
  const meta = [
    formatDuration(job.durationMs),
    formatBytes(job.byteSize),
    job.language ? job.language.toUpperCase() : null,
    showUser ? job.displayName : null,
    finished ? `fertig ${formatDateTime(finished)}` : null,
    job.status === "failed" ? `zuletzt ${formatDateTime(job.updatedAt)}` : null,
  ].filter(Boolean);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 0.75,
        borderBottom: 1,
        borderColor: "divider",
        "&:last-of-type": { borderBottom: 0 },
      }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap title={jobTitle(job)}>
          {jobTitle(job)}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" noWrap>
          {meta.join(" · ")}
        </Typography>
        {job.error && (
          <Typography variant="caption" color="error.main" display="block">
            {job.error}
          </Typography>
        )}
      </Box>

      {job.percent !== null && job.status !== "done" && (
        <Box sx={{ width: 90 }}>
          <LinearProgress variant="determinate" value={job.percent * 100} sx={{ height: 6, borderRadius: 3 }} />
          <Typography variant="caption" color="text.secondary">
            {formatPercent(job.percent)}
          </Typography>
        </Box>
      )}

      <Chip
        size="small"
        variant="outlined"
        color={job.status === "failed" ? "error" : job.status === "done" ? "success" : "default"}
        label={STATUS_LABEL[job.status] ?? job.status}
      />

      {job.status === "failed" && (
        <Tooltip title="Erneut in die Warteschlange">
          <span>
            <IconButton size="small" onClick={() => onRetry(job)} disabled={retrying}>
              <ReplayIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}

      {isOwn && job.path ? (
        <Tooltip title="Quelle öffnen">
          <IconButton size="small" onClick={() => onOpen(job.path as string)}>
            <OpenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Box sx={{ width: 28 }} />
      )}
    </Box>
  );
}

function ProgressPanel({ data, scope }: { data: AudioOverview; scope: AudioScope }) {
  const { run, eta, server, deviceJobs, queue } = data;
  const scopeLabel = scope === "all" ? "alle Aufnahmen" : "deine Warteschlange";

  if (run) {
    return (
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1}>
          <Typography variant="h6">Verarbeitung läuft</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip size="small" variant="outlined" label={`seit ${formatDateTime(run.startedAt)}`} />
            <Chip
              size="small"
              variant="outlined"
              label={run.triggeredBy === "admin" ? "manuell gestartet" : "Nachtlauf"}
            />
          </Stack>
        </Stack>

        <LinearProgress variant="determinate" value={run.percent * 100} sx={{ height: 8, borderRadius: 1 }} />

        <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1} mt={1}>
          <Typography variant="body2">
            {formatPercent(run.percent)} der Audiolänge · {run.doneJobs + run.remainingJobs} Aufnahmen in der
            Schlange
          </Typography>
          {eta.etaQueueMs !== null && (
            <Typography variant="body2">
              Restzeit für {scopeLabel}: <strong>ca. {formatEta(eta.etaQueueMs)}</strong>
            </Typography>
          )}
        </Stack>

        {run.current && (
          <Typography variant="body2" color="text.secondary" display="block" mt={0.5}>
            Aktuelle Aufnahme: {formatDuration(run.current.durationMs)} · {formatPercent(run.current.percent)}
            {eta.etaCurrentMs !== null ? ` · noch ca. ${formatEta(eta.etaCurrentMs)}` : ""}
          </Typography>
        )}

        {eta.rate !== null && (
          <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
            Tempo: {formatRate(eta.rate)}
            {eta.rateSource === "history" ? " (aus dem Verlauf geschätzt)" : ""}
          </Typography>
        )}
      </Paper>
    );
  }

  if (deviceJobs > 0) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        {deviceJobs} Aufnahme{deviceJobs === 1 ? "" : "n"} laufen gerade auf einem Gerät (Browser-Tab). Dort ist kein
        Fortschritt messbar – der Browser meldet nur einen Heartbeat, keine Position im Audio.
      </Alert>
    );
  }

  return (
    <Alert severity={queue.pending > 0 || queue.failed > 0 ? "warning" : "info"} sx={{ mb: 2 }}>
      {queue.pending > 0 || queue.failed > 0
        ? "Wartet — kein Verarbeiter aktiv."
        : "Nichts zu tun — alle Aufnahmen sind transkribiert."}
      {server.enabled
        ? ` Der nächste Server-Lauf startet ${server.nextRunAt ? formatDateTime(server.nextRunAt) : "nachts"}.`
        : " Die Verarbeitung startet, sobald die App in einem Browser geöffnet ist."}
    </Alert>
  );
}

export function AudioPage() {
  const { user } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();

  const [scope, setScope] = useState<AudioScope>("mine");
  const [limit, setLimit] = useState(50);
  const [data, setData] = useState<AudioOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [requeueing, setRequeueing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getAudioOverview({ scope, limit }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Übersicht konnte nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, [scope, limit]);

  const active = Boolean(data?.run) || (data?.deviceJobs ?? 0) > 0;

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, active]);

  const handleRetry = async (job: AudioJob) => {
    setRetryingId(job.id);
    try {
      await retryJob(job.id);
      notify("Auftrag wieder eingeplant", "success");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Erneut einplanen fehlgeschlagen", "error");
    } finally {
      setRetryingId(null);
    }
  };

  const handleRequeueAll = async () => {
    const label = scope === "all" ? "alle fehlgeschlagenen Aufträge aller Nutzer" : "alle deine fehlgeschlagenen Aufträge";
    if (!window.confirm(`${label} erneut in die Warteschlange stellen?`)) return;
    setRequeueing(true);
    try {
      const count = await requeueFailedJobs(scope);
      notify(
        count === 0 ? "Keine fehlgeschlagenen Aufträge" : `${count} Auftrag${count === 1 ? "" : "e"} wieder eingeplant`,
        count === 0 ? "info" : "success"
      );
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Wieder einreihen fehlgeschlagen", "error");
    } finally {
      setRequeueing(false);
    }
  };

  const showUser = scope === "all";
  const jobs = data?.jobs;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
        <Typography variant="h4">Audio-Verarbeitung</Typography>
        {user?.isAdmin && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={scope}
            onChange={(_event, value) => {
              if (value === null) return;
              setScope(value);
              setLimit(50);
            }}
          >
            <ToggleButton value="mine">Nur ich</ToggleButton>
            <ToggleButton value="all">Alle Nutzer</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && !data && (
        <Stack alignItems="center" py={4}>
          <CircularProgress />
        </Stack>
      )}

      {data && (
        <>
          <ProgressPanel data={data} scope={scope} />

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap mb={2}>
            <Paper variant="outlined" sx={{ p: 1.5, flex: "1 1 130px" }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Offen
              </Typography>
              <Typography variant="h6">{data.queue.pending}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, flex: "1 1 130px" }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Fehlgeschlagen
              </Typography>
              <Typography variant="h6">{data.queue.failed}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, flex: "1 1 130px" }}>
              <Typography variant="caption" color="text.secondary" display="block">
                In Arbeit
              </Typography>
              <Typography variant="h6">{data.queue.running}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, flex: "1 1 130px" }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Offene Audiolänge
              </Typography>
              <Typography variant="h6">{formatDuration(data.eta.openMediaMs)}</Typography>
            </Paper>
          </Stack>

          <Box sx={{ mb: 3 }}>
            <AudioStatsPanel scope={scope} />
          </Box>

          {jobs && jobs.active.length > 0 && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" gutterBottom>
                In Arbeit
              </Typography>
              {jobs.active.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  isOwn={job.userId === user?.id}
                  showUser={showUser}
                  onOpen={navigate}
                  onRetry={handleRetry}
                  retrying={retryingId === job.id}
                />
              ))}
            </Paper>
          )}

          {jobs && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="h6">Zuletzt fertig (24 Stunden)</Typography>
                <Typography variant="caption" color="text.secondary">
                  {jobs.recent.length} von {data.recentTotal}
                </Typography>
              </Stack>

              {jobs.recent.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  In den letzten 24 Stunden wurde nichts fertig.
                </Typography>
              ) : (
                jobs.recent.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    isOwn={job.userId === user?.id}
                    showUser={showUser}
                    onOpen={navigate}
                    onRetry={handleRetry}
                    retrying={retryingId === job.id}
                  />
                ))
              )}

              {data.recentTotal > jobs.recent.length && (
                <Button size="small" sx={{ mt: 1 }} onClick={() => setLimit((value) => value + 50)}>
                  Mehr laden
                </Button>
              )}
            </Paper>
          )}

          {jobs && (
            <Paper sx={{ p: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
                <Typography variant="h6">Fehlgeschlagen</Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => void handleRequeueAll()}
                  disabled={requeueing || jobs.failed.length === 0}
                >
                  Alle wieder einreihen
                </Button>
              </Stack>

              {jobs.failed.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Keine fehlgeschlagenen Aufträge.
                </Typography>
              ) : (
                jobs.failed.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    isOwn={job.userId === user?.id}
                    showUser={showUser}
                    onOpen={navigate}
                    onRetry={handleRetry}
                    retrying={retryingId === job.id}
                  />
                ))
              )}
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
