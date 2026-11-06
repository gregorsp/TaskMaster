import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { LineChart } from "@mui/x-charts/LineChart";
import {
  getMeditationStats,
  type MeditationStats,
  type StatsRangeSelection,
  type StatsScope,
} from "../../api/statsApi";
import { formatPercent, formatShortDay } from "../../utils/format";
import { KpiTile } from "./KpiTile";
import { countDelta, formatDecimal, rateDelta } from "./delta";

interface Props {
  scope: StatsScope;
  range: StatsRangeSelection;
}

/** Meditations-Sektion: Minuten, Sessions, Konzentration und Plan-Treue. */
export function MeditationStatsPanel({ scope, range }: Props) {
  const [stats, setStats] = useState<MeditationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { preset, from, to } = range;

  const load = useCallback(async () => {
    try {
      setStats(await getMeditationStats(scope, { preset, from, to }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Meditations-Statistik konnte nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, [scope, preset, from, to]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const totals = stats?.totals;
  const previous = stats?.previous;
  const days = stats?.days ?? [];
  const concentrationMax = Math.max(1, ...(stats?.concentration.map((entry) => entry.count) ?? [1]));

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
        <Typography variant="h6">Meditation{scope === "all" ? " (alle Nutzer)" : ""}</Typography>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && !stats && (
        <Stack alignItems="center" py={3}>
          <CircularProgress size={24} />
        </Stack>
      )}

      {stats && totals && previous && (
        <>
          {totals.sessions === 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Keine Meditationen in diesem Zeitraum.
            </Alert>
          )}

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap mb={2}>
            <KpiTile
              label="Sessions"
              value={String(totals.sessions)}
              delta={countDelta(totals.sessions, previous.sessions)}
            />
            <KpiTile
              label="Minuten"
              value={String(totals.minutes)}
              hint={totals.avgMinutes == null ? undefined : `Ø ${formatDecimal(totals.avgMinutes, 1)} min`}
              delta={countDelta(totals.minutes, previous.minutes)}
            />
            <KpiTile
              label="Ø Konzentration"
              value={totals.avgConcentration == null ? "–" : formatDecimal(totals.avgConcentration, 1)}
              hint={`${totals.ratedSessions} bewertet`}
            />
            <KpiTile
              label="Plan-Treue"
              value={formatPercent(totals.adherenceRate, 0)}
              hint={`${totals.plannedMinutes} min geplant`}
              delta={rateDelta(totals.adherenceRate, previous.adherenceRate)}
            />
            <KpiTile
              label="Streak"
              value={`${totals.currentStreak} Tage`}
              hint={`bester: ${totals.bestStreak} Tage`}
            />
            <KpiTile label="Kommentare" value={String(totals.comments)} />
          </Stack>

          <Typography variant="subtitle2" gutterBottom>
            Minuten pro Tag
          </Typography>
          <LineChart
            height={220}
            margin={{ left: 48, right: 16, top: 8, bottom: 32 }}
            xAxis={[
              {
                scaleType: "point",
                data: days.map((day) => day.date),
                valueFormatter: (value) => formatShortDay(String(value)),
              },
            ]}
            series={[
              {
                data: days.map((day) => day.minutes),
                label: "Minuten",
                area: true,
                curve: "monotoneX",
                showMark: days.length <= 14,
              },
            ]}
          />

          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Konzentration
            </Typography>
            {stats.concentration.map((entry) => (
              <Stack key={entry.rating} direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <Typography variant="body2" sx={{ minWidth: 24 }}>
                  {entry.rating}
                </Typography>
                <Box
                  sx={{
                    flexGrow: 1,
                    height: 8,
                    borderRadius: 1,
                    bgcolor: "action.hover",
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      width: `${(entry.count / concentrationMax) * 100}%`,
                      height: "100%",
                      bgcolor: "primary.main",
                    }}
                  />
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 28, textAlign: "right" }}>
                  {entry.count}
                </Typography>
              </Stack>
            ))}
          </Box>

          {stats.perUser && stats.perUser.length > 0 && (
            <Box sx={{ mt: 2.5 }}>
              <Typography variant="subtitle2" gutterBottom>
                Pro Nutzer
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Nutzer</TableCell>
                    <TableCell align="right">Sessions</TableCell>
                    <TableCell align="right">Minuten</TableCell>
                    <TableCell align="right">Ø Konzentration</TableCell>
                    <TableCell align="right">Plan-Treue</TableCell>
                    <TableCell align="right">Streak</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stats.perUser.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell>{row.displayName}</TableCell>
                      <TableCell align="right">{row.sessions}</TableCell>
                      <TableCell align="right">{row.minutes}</TableCell>
                      <TableCell align="right">
                        {row.avgConcentration == null ? "–" : formatDecimal(row.avgConcentration, 1)}
                      </TableCell>
                      <TableCell align="right">{formatPercent(row.adherenceRate, 0)}</TableCell>
                      <TableCell align="right">{row.currentStreak}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            Plan-Treue zählt nur Sessions mit geplanter Dauer. Streaks zählen Kalendertage mit mindestens einer Session.
          </Typography>
        </>
      )}
    </Paper>
  );
}
