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
import { LineChart } from "@mui/x-charts/LineChart";
import {
  getTaskStats,
  type HabitStatsPerUser,
  type StatsRangeSelection,
  type StatsScope,
  type TaskStats,
  type TaskStatsLens,
  type TaskStatsPerUser,
} from "../../api/statsApi";
import { formatPercent, formatShortDay } from "../../utils/format";
import { KpiTile } from "./KpiTile";
import { countDelta, formatDecimal, invertDelta, rateDelta } from "./delta";

const LENSES: { value: TaskStatsLens; label: string }[] = [
  { value: "completed", label: "Erledigt" },
  { value: "created", label: "Erstellt" },
  { value: "assigned", label: "Zugewiesen" },
];

const QUADRANTS = [
  { key: "do", label: "Tun" },
  { key: "plan", label: "Planen" },
  { key: "delegate", label: "Delegieren" },
  { key: "drop", label: "Verwerfen" },
] as const;

function TaskPerUserTable({ rows }: { rows: TaskStatsPerUser[] }) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Nutzer</TableCell>
          <TableCell align="right">Erledigt</TableCell>
          <TableCell align="right">Erstellt</TableCell>
          <TableCell align="right">Rechtzeitig</TableCell>
          <TableCell align="right">Offen</TableCell>
          <TableCell align="right">Überfällig</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.userId}>
            <TableCell>{row.displayName}</TableCell>
            <TableCell align="right">{row.completed}</TableCell>
            <TableCell align="right">{row.created}</TableCell>
            <TableCell align="right">{formatPercent(row.onTimeRate, 0)}</TableCell>
            <TableCell align="right">{row.open == null ? "–" : row.open}</TableCell>
            <TableCell align="right">{row.overdue == null ? "–" : row.overdue}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function HabitPerUserTable({ rows }: { rows: HabitStatsPerUser[] }) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Nutzer</TableCell>
          <TableCell align="right">Habits</TableCell>
          <TableCell align="right">Quote</TableCell>
          <TableCell align="right">Tage</TableCell>
          <TableCell align="right">Aktueller Streak</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.userId}>
            <TableCell>{row.displayName}</TableCell>
            <TableCell align="right">{row.habits}</TableCell>
            <TableCell align="right">{formatPercent(row.rate, 0)}</TableCell>
            <TableCell align="right">
              {row.completedDays} / {row.expectedDays}
            </TableCell>
            <TableCell align="right">{row.currentStreak}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface Props {
  scope: StatsScope;
  range: StatsRangeSelection;
}

/** Aufgaben-Sektion: Durchsatz, Pünktlichkeit, Verteilungen und Habits. */
export function TaskStatsPanel({ scope, range }: Props) {
  const [lens, setLens] = useState<TaskStatsLens>("completed");
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { preset, from, to } = range;

  const load = useCallback(async () => {
    try {
      setStats(await getTaskStats(scope, lens, { preset, from, to }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aufgaben-Statistik konnte nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, [scope, lens, preset, from, to]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const totals = stats?.totals;
  const previous = stats?.previous;
  const days = stats?.days ?? [];
  const distributions = stats?.distributions;
  const habits = stats?.habits;
  const dayCount = stats?.range.days ?? 1;
  const hasActivity = Boolean(totals && (totals.completed > 0 || totals.created > 0 || (totals.open ?? 0) > 0));

  const categoryMax = Math.max(1, ...(distributions?.categories.map((bucket) => bucket.count) ?? [1]));
  const createdPerDay = totals ? totals.created / dayCount : 0;
  const previousCreatedPerDay = previous ? previous.created / dayCount : 0;

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
        <Typography variant="h6">Aufgaben{scope === "all" ? " (alle Nutzer)" : ""}</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={lens}
          onChange={(_event, next: TaskStatsLens | null) => next && setLens(next)}
        >
          {LENSES.map((entry) => (
            <ToggleButton key={entry.value} value={entry.value}>
              {entry.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
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
          {!hasActivity && !habits?.overall.habits && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Keine Aufgaben-Aktivität in diesem Zeitraum.
            </Alert>
          )}

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap mb={2}>
            {lens === "completed" && (
              <>
                <KpiTile
                  label="Erledigt"
                  value={String(totals.completed)}
                  hint="Aktionen im Zeitraum"
                  delta={countDelta(totals.completed, previous.completed)}
                />
                <KpiTile
                  label="Rechtzeitig"
                  value={formatPercent(totals.onTimeRate, 0)}
                  hint={`${totals.onTime} von ${totals.onTime + totals.late} bewertbar`}
                  delta={rateDelta(totals.onTimeRate, previous.onTimeRate)}
                />
                <KpiTile
                  label="Überfällig erledigt"
                  value={String(totals.late)}
                  delta={invertDelta(countDelta(totals.late, previous.late))}
                />
                <KpiTile
                  label="Ohne Frist"
                  value={String(totals.withoutDeadline)}
                  hint="nicht in der Quote"
                />
              </>
            )}

            {lens === "created" && (
              <>
                <KpiTile
                  label="Erstellt"
                  value={String(totals.created)}
                  hint="Aufgaben im Zeitraum"
                  delta={countDelta(totals.created, previous.created)}
                />
                <KpiTile
                  label="Davon erledigt"
                  value={String(totals.completed)}
                  hint="Erledigungen im Zeitraum"
                  delta={countDelta(totals.completed, previous.completed)}
                />
                <KpiTile
                  label="Rechtzeitig"
                  value={formatPercent(totals.onTimeRate, 0)}
                  hint={`${totals.onTime} von ${totals.onTime + totals.late} bewertbar`}
                  delta={rateDelta(totals.onTimeRate, previous.onTimeRate)}
                />
                <KpiTile
                  label="Ø pro Tag"
                  value={formatDecimal(createdPerDay, 1)}
                  delta={countDelta(createdPerDay, previousCreatedPerDay)}
                />
              </>
            )}

            {lens === "assigned" && (
              <>
                <KpiTile label="Offen" value={String(totals.open ?? 0)} hint="nur einmalige Aufgaben" />
                <KpiTile label="Überfällig" value={String(totals.overdue ?? 0)} />
                <KpiTile label="Ohne Frist" value={String(totals.openWithoutDue ?? 0)} hint="in der offenen Menge" />
                <KpiTile
                  label="Erledigt im Zeitraum"
                  value={String(totals.completed)}
                  delta={countDelta(totals.completed, previous.completed)}
                />
              </>
            )}
          </Stack>

          <Typography variant="subtitle2" gutterBottom>
            Verlauf
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
                data: days.map((day) => day.completed),
                label: "erledigt",
                curve: "monotoneX",
                showMark: days.length <= 14,
              },
              {
                data: days.map((day) => day.created),
                label: "erstellt",
                curve: "monotoneX",
                showMark: false,
              },
            ]}
          />

          {distributions && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                Verteilungen ({distributions.tasks} Aufgaben)
              </Typography>

              {distributions.categories.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Keine Aufgaben in dieser Sicht.
                </Typography>
              ) : (
                distributions.categories.map((bucket) => (
                  <Stack key={bucket.id ?? "none"} direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: bucket.color,
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="body2" sx={{ minWidth: 140, flexShrink: 0 }}>
                      {bucket.name}
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
                          width: `${(bucket.count / categoryMax) * 100}%`,
                          height: "100%",
                          bgcolor: bucket.color,
                        }}
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 28, textAlign: "right" }}>
                      {bucket.count}
                    </Typography>
                  </Stack>
                ))
              )}

              <Stack direction="row" gap={2} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                <Paper variant="outlined" sx={{ p: 1.5, flex: "1 1 200px" }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Wichtigkeit
                  </Typography>
                  <Stack direction="row" spacing={2}>
                    <Typography variant="body2">Wichtig: {distributions.importance.important}</Typography>
                    <Typography variant="body2">Normal: {distributions.importance.normal}</Typography>
                  </Stack>
                </Paper>
                <Paper variant="outlined" sx={{ p: 1.5, flex: "1 1 260px" }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Eisenhower (aktueller Stand)
                  </Typography>
                  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5 }}>
                    {QUADRANTS.map((quadrant) => (
                      <Typography key={quadrant.key} variant="body2">
                        {quadrant.label}: {distributions.quadrants[quadrant.key]}
                      </Typography>
                    ))}
                  </Box>
                </Paper>
              </Stack>
            </Box>
          )}

          {habits && (
            <Box sx={{ mt: 2.5 }}>
              <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap" useFlexGap>
                <Typography variant="subtitle2">Habits</Typography>
                <Typography variant="caption" color="text.secondary">
                  Quote geschätzt: täglich erwartet
                </Typography>
              </Stack>

              {habits.overall.habits === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Keine Habits angelegt.
                </Typography>
              ) : (
                <>
                  <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap mb={1.5} mt={1}>
                    <KpiTile
                      label="Habit-Quote"
                      value={formatPercent(habits.overall.rate, 0)}
                      hint={`${habits.overall.completedDays} von ${habits.overall.expectedDays} Tagen`}
                    />
                    <KpiTile label="Aktueller Streak" value={`${habits.overall.currentStreak} Tage`} />
                    <KpiTile label="Bester Streak" value={`${habits.overall.bestStreak} Tage`} />
                  </Stack>

                  {habits.items && habits.items.length > 0 && (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Habit</TableCell>
                          <TableCell align="right">Quote</TableCell>
                          <TableCell align="right">Tage</TableCell>
                          <TableCell align="right">Aktuell</TableCell>
                          <TableCell align="right">Bester Streak</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {habits.items.map((item) => (
                          <TableRow key={item.taskId}>
                            <TableCell>{item.title}</TableCell>
                            <TableCell align="right">{formatPercent(item.rate, 0)}</TableCell>
                            <TableCell align="right">
                              {item.completedDays} / {item.expectedDays}
                            </TableCell>
                            <TableCell align="right">{item.currentStreak}</TableCell>
                            <TableCell align="right">{item.bestStreak}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}

                  {habits.perUser && habits.perUser.length > 0 && (
                    <HabitPerUserTable rows={habits.perUser} />
                  )}
                </>
              )}
            </Box>
          )}

          {stats.perUser && stats.perUser.length > 0 && (
            <Box sx={{ mt: 2.5 }}>
              <Typography variant="subtitle2" gutterBottom>
                Pro Nutzer
              </Typography>
              <TaskPerUserTable rows={stats.perUser} />
            </Box>
          )}

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            Grundlage sind Erledigungs-Aktionen. Gelöschte Aufgaben fehlen in der Historie.
          </Typography>
        </>
      )}
    </Paper>
  );
}
