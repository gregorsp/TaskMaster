import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { PlayArrow as EngageIcon, Schedule as BlocksIcon } from "@mui/icons-material";
import {
  timeBlocksApi, weekdayOf, minutesOf, formatMinutes, type TimeBlock,
} from "../../api/horizonsApi";
import { listContexts, type TaskContext } from "../../api/contextsApi";
import type { TaskDuration } from "../../api/tasksApi";
import { ENERGY_LABELS } from "../tasks/gtd";

/** Größte GTD-Dauer, die in die verbleibende Zeit passt (über 60 Min: keine Grenze). */
function durationFor(remaining: number): TaskDuration | "" {
  if (remaining > 60) return "";
  const fits: [TaskDuration, number][] = [["60_min", 60], ["30_min", 30], ["15_min", 15]];
  return fits.find(([, m]) => remaining >= m)?.[0] ?? "under_2_min";
}

/** Link auf die Nächsten Schritte, gefiltert passend zum Block (Kontext, Energie, Restzeit). */
export function engageLink(block: TimeBlock, now: Date): string {
  const params = new URLSearchParams({ tab: "next" });
  if (block.contextId) params.set("contextId", block.contextId);
  if (block.energy) params.set("maxEnergy", block.energy);
  const duration = durationFor(block.endMinute - minutesOf(now));
  if (duration) params.set("maxDuration", duration);
  return `/gtd?${params}`;
}

interface Props {
  /** Optional schon geladene Blöcke (Zeitblock-Seite); sonst lädt die Karte selbst. */
  blocks?: TimeBlock[];
  /** Optional schon geladene Kontexte; sonst lädt die Karte sie selbst. */
  contexts?: TaskContext[];
  /** Kompakt (Tagesansicht): blendet sich aus, wenn heute keine Blöcke existieren. */
  compact?: boolean;
}

/** „Jetzt“-Karte: aktueller Block mit Absprung zu passenden Nächsten Schritten, darunter der restliche Tag. */
export function TodayBlocks({ blocks: given, contexts: givenContexts, compact = false }: Props) {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<TimeBlock[]>([]);
  const [loadedContexts, setLoadedContexts] = useState<TaskContext[]>([]);
  const contexts = givenContexts ?? loadedContexts;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!given) timeBlocksApi.list().then(setLoaded).catch(() => setLoaded([]));
  }, [given]);
  useEffect(() => {
    if (!givenContexts) listContexts().then(setLoadedContexts).catch(() => {});
  }, [givenContexts]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const today = (given ?? loaded).filter((b) => b.weekday === weekdayOf(now));
  if (compact && today.length === 0) return null;

  const minute = minutesOf(now);
  const current = today.find((b) => b.startMinute <= minute && minute < b.endMinute);
  const upcoming = today.filter((b) => b.startMinute > minute);
  const contextName = (id: string | null) => contexts.find((c) => c.id === id)?.name;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: current ? "primary.main" : undefined }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <BlocksIcon color={current ? "primary" : "action"} />
        <Typography variant="subtitle1" fontWeight={700}>
          {current ? `Jetzt: ${current.title}` : "Gerade kein Zeitblock"}
        </Typography>
      </Stack>

      {current ? (
        <Stack direction="row" flexWrap="wrap" alignItems="center" gap={1}>
          <Chip size="small" label={`${formatMinutes(current.startMinute)}–${formatMinutes(current.endMinute)} · noch ${current.endMinute - minute} Min`} />
          {contextName(current.contextId) && <Chip size="small" variant="outlined" label={contextName(current.contextId)} />}
          {current.energy && <Chip size="small" variant="outlined" label={`Energie ${ENERGY_LABELS[current.energy]}`} />}
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" startIcon={<EngageIcon />} onClick={() => navigate(engageLink(current, now))}>
            Passende Schritte
          </Button>
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {today.length === 0 ? "Heute sind keine Zeitblöcke eingeplant." : upcoming.length === 0 ? "Für heute sind alle Blöcke vorbei." : "Nutze die Zeit bis zum nächsten Block frei."}
        </Typography>
      )}

      {upcoming.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={1} mt={1.5}>
          {upcoming.map((b) => (
            <Chip key={b.id} size="small" variant="outlined" label={`${formatMinutes(b.startMinute)} ${b.title}`} />
          ))}
        </Stack>
      )}
    </Paper>
  );
}
