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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { LineChart } from "@mui/x-charts/LineChart";
import {
  getAudioStats,
  type AudioStats,
  type StatsRangeSelection,
  type StatsScope,
} from "../../api/statsApi";
import { formatDuration, formatPercent, formatShortDay, formatSpeedup } from "../../utils/format";
import { KpiTile } from "./KpiTile";
import { countDelta, invertDelta, rateDelta } from "./delta";

const SHORT_RANGES: { value: StatsRangeSelection["preset"]; label: string }[] = [
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
  { value: "90d", label: "90 Tage" },
];

const ENGINE_LABELS: Record<string, string> = {
  server: "Server",
  device: "Gerät",
  unknown: "Unbekannt",
};

interface Props {
  scope: StatsScope;
  /** Wenn gesetzt, gilt der Zeitraum der Seite und die interne Auswahl entfällt. */
  range?: StatsRangeSelection;
  /** Titelzeile ausblenden, wenn die Seite schon eine hat. */
  dense?: boolean;
}

/**
 * Kennzahlen zur Verarbeitung. Steht identisch auf der Audio-Übersicht und auf
 * der Statistik-Seite – eine Komponente, ein Endpoint.
 */
export function AudioStatsPanel({ scope, range, dense = false }: Props) {
  const [internalRange, setInternalRange] = useState<StatsRangeSelection>({ preset: "30d" });
  const [stats, setStats] = useState<AudioStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeRange = range ?? internalRange;
  const { preset, from, to } = activeRange;

  const load = useCallback(async () => {
    try {
      setStats(await getAudioStats(scope, { preset, from, to }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Statistik konnte nicht geladen werden");
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
  const hasData = (totals?.done ?? 0) + (totals?.failed ?? 0) > 0;
  const minutesPerDay = days.map((day) => Math.round(day.mediaMs / 60_000));
  const mediaMinutes = totals ? Math.round(totals.mediaMs / 60_000) : 0;
  const previousMinutes = previous ? Math.round(previous.mediaMs / 60_000) : 0;

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
        {!dense && (
          <Typography variant="h6">
            Audio{scope === "all" ? " (alle Nutzer)" : ""}
          </Typography>
        )}
        {!range && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={activeRange.preset}
            onChange={(_event, value: StatsRangeSelection["preset"] | null) =>
              value && setInternalRange({ preset: value })
            }
          >
            {SHORT_RANGES.map((entry) => (
              <ToggleButton key={entry.value} value={entry.value}>
                {entry.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
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

      {totals && !hasData && (
        <Alert severity="info">
          Noch keine abgeschlossenen Aufnahmen in diesem Zeitraum. Bearbeitungszeiten und Echtzeitfaktor werden
          erst ab dem ersten Lauf mit der neuen Datenbank-Version gemessen.
        </Alert>
      )}

      {totals && hasData && (
        <>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap mb={2}>
            <KpiTile
              label="Fertige Aufnahmen"
              value={String(totals.done)}
              hint={`${totals.failed} fehlgeschlagen`}
              delta={countDelta(totals.done, previous?.done)}
            />
            <KpiTile
              label="Audiominuten"
              value={String(mediaMinutes)}
              delta={countDelta(mediaMinutes, previousMinutes)}
            />
            <KpiTile
              label="Mediane Bearbeitungszeit"
              value={formatDuration(totals.medianProcMs)}
              hint="pro Aufnahme"
            />
            <KpiTile label="Echtzeitfaktor" value={formatSpeedup(totals.speedup)} hint="höher ist besser" />
            <KpiTile
              label="Fehlerquote"
              value={formatPercent(totals.failureRate, 0)}
              delta={invertDelta(rateDelta(totals.failureRate, previous?.failureRate))}
            />
          </Stack>

          <Typography variant="subtitle2" gutterBottom>
            Audiominuten pro Tag
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
                data: minutesPerDay,
                label: "Audiominuten",
                area: true,
                curve: "monotoneX",
                showMark: days.length <= 14,
              },
            ]}
          />

          <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
            Aufnahmen pro Tag
          </Typography>
          <BarChart
            height={220}
            margin={{ left: 48, right: 16, top: 8, bottom: 32 }}
            xAxis={[
              {
                scaleType: "band",
                data: days.map((day) => day.date),
                valueFormatter: (value) => formatShortDay(String(value)),
              },
            ]}
            series={[
              { data: days.map((day) => day.done), label: "fertig", stack: "total" },
              { data: days.map((day) => day.failed), label: "fehlgeschlagen", stack: "total" },
            ]}
          />

          {stats?.byEngine && stats.byEngine.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Server und Gerät
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Quelle</TableCell>
                    <TableCell align="right">Fertig</TableCell>
                    <TableCell align="right">Fehlgeschlagen</TableCell>
                    <TableCell align="right">Audiominuten</TableCell>
                    <TableCell align="right">Echtzeitfaktor</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stats.byEngine.map((row) => (
                    <TableRow key={row.engine}>
                      <TableCell>{ENGINE_LABELS[row.engine] ?? row.engine}</TableCell>
                      <TableCell align="right">{row.done}</TableCell>
                      <TableCell align="right">{row.failed}</TableCell>
                      <TableCell align="right">{Math.round(row.mediaMs / 60_000)}</TableCell>
                      <TableCell align="right">{formatSpeedup(row.speedup)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}

          {stats?.perUser && stats.perUser.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Pro Nutzer
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Nutzer</TableCell>
                    <TableCell align="right">Fertig</TableCell>
                    <TableCell align="right">Fehlgeschlagen</TableCell>
                    <TableCell align="right">Audiominuten</TableCell>
                    <TableCell align="right">Echtzeitfaktor</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stats.perUser.map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell>{row.displayName}</TableCell>
                      <TableCell align="right">{row.done}</TableCell>
                      <TableCell align="right">{row.failed}</TableCell>
                      <TableCell align="right">{Math.round(row.mediaMs / 60_000)}</TableCell>
                      <TableCell align="right">{formatSpeedup(row.speedup)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            Bearbeitungszeiten und Echtzeitfaktor werden erst ab Datenbank-Version 0018 gemessen.
          </Typography>
        </>
      )}
    </Paper>
  );
}
