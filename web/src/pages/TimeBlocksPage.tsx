import { useCallback, useEffect, useState } from "react";
import {
  Box, Typography, Stack, Button, Paper, Chip, IconButton, Tooltip, TextField, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress, useMediaQuery, useTheme,
} from "@mui/material";
import { Schedule as BlocksIcon, Add as AddIcon, Edit as EditIcon } from "@mui/icons-material";
import {
  timeBlocksApi, WEEKDAYS, WEEKDAY_LABELS, formatMinutes, parseTime, weekdayOf,
  type TimeBlock, type Weekday,
} from "../api/horizonsApi";
import { listContexts, type TaskContext } from "../api/contextsApi";
import type { TaskEnergy } from "../api/tasksApi";
import { useNotify } from "../context/NotifyContext";
import { ENERGY_LABELS, labelEntries } from "../components/tasks/gtd";
import { TodayBlocks } from "../components/timeblocks/TodayBlocks";

const PRESETS: { label: string; days: Weekday[] }[] = [
  { label: "Mo–Fr", days: ["mon", "tue", "wed", "thu", "fri"] },
  { label: "Wochenende", days: ["sat", "sun"] },
  { label: "Jeden Tag", days: [...WEEKDAYS] },
];

/** Anlegen (mehrere Tage auf einmal) oder Bearbeiten (ein Tag) eines Blocks. */
function BlockDialog({ block, contexts, onClose, onSaved }: {
  block: TimeBlock | "new"; contexts: TaskContext[]; onClose: () => void; onSaved: () => void;
}) {
  const notify = useNotify();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const existing = block === "new" ? null : block;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [days, setDays] = useState<Weekday[]>(existing ? [existing.weekday] : [weekdayOf(new Date())]);
  const [start, setStart] = useState(formatMinutes(existing?.startMinute ?? 9 * 60));
  const [end, setEnd] = useState(formatMinutes(existing?.endMinute ?? 11 * 60));
  const [contextId, setContextId] = useState(existing?.contextId ?? "");
  const [energy, setEnergy] = useState<TaskEnergy | "">(existing?.energy ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startMinute = parseTime(start);
  const endMinute = parseTime(end);
  const valid = title.trim() && days.length > 0 && endMinute > startMinute;

  const toggleDay = (d: Weekday) =>
    setDays((prev) => existing ? [d] : prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  const save = async () => {
    const fields = { title: title.trim(), startMinute, endMinute, contextId: contextId || null, energy: energy || null };
    try {
      if (existing) await timeBlocksApi.update(existing.id, { ...fields, weekday: days[0] });
      else await timeBlocksApi.create({ ...fields, weekdays: days });
      notify(existing ? "Zeitblock gespeichert" : `Zeitblock für ${days.length} Tag(e) angelegt`);
      onSaved();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      notify(err.response?.data?.error?.message || "Zeitblock konnte nicht gespeichert werden", "error");
    }
  };

  const remove = async () => {
    if (!existing) return;
    try {
      await timeBlocksApi.remove(existing.id);
      notify("Zeitblock gelöscht");
      onSaved();
    } catch {
      notify("Zeitblock konnte nicht gelöscht werden", "error");
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle>{existing ? "Zeitblock bearbeiten" : "Neuer Zeitblock"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <TextField label="Wofür?" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus fullWidth
            placeholder="z. B. Deep Work, Telefonate, Uni" />
          <Box>
            <Typography variant="body2" color="text.secondary" mb={1}>{existing ? "Tag" : "Tage"}</Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {WEEKDAYS.map((d) => (
                <Chip key={d} label={WEEKDAY_LABELS[d].slice(0, 2)} onClick={() => toggleDay(d)}
                  color={days.includes(d) ? "primary" : "default"} variant={days.includes(d) ? "filled" : "outlined"} />
              ))}
            </Stack>
            {!existing && (
              <Stack direction="row" flexWrap="wrap" gap={1} mt={1}>
                {PRESETS.map((p) => <Chip key={p.label} size="small" variant="outlined" label={p.label} onClick={() => setDays(p.days)} />)}
              </Stack>
            )}
          </Box>
          <Stack direction="row" spacing={2}>
            <TextField label="Von" type="time" value={start} onChange={(e) => setStart(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
            <TextField label="Bis" type="time" value={end} onChange={(e) => setEnd(e.target.value)} fullWidth InputLabelProps={{ shrink: true }}
              error={endMinute <= startMinute} helperText={endMinute <= startMinute ? "Ende nach Beginn" : " "} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Optional: Was passt in diesen Block? „Passende Schritte“ filtert dann danach.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select label="Kontext" value={contextId} onChange={(e) => setContextId(e.target.value)} fullWidth>
              <MenuItem value="">Beliebig</MenuItem>
              {contexts.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
            <TextField select label="Energie" value={energy} onChange={(e) => setEnergy(e.target.value as TaskEnergy | "")} fullWidth>
              <MenuItem value="">Beliebig</MenuItem>
              {labelEntries(ENERGY_LABELS).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
            </TextField>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        {existing && (confirmDelete
          ? <Button color="error" variant="contained" onClick={remove}>Wirklich löschen</Button>
          : <Button color="error" onClick={() => setConfirmDelete(true)}>Löschen</Button>)}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={save} disabled={!valid}>Speichern</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Feste Zeitblöcke pro Wochentag (Time-Blocking). Ein Block kann Kontext und
 * Energie vorgeben – „Passende Schritte“ öffnet dann die Nächsten Schritte
 * genau dafür, begrenzt auf die verbleibende Zeit.
 */
export function TimeBlocksPage() {
  const notify = useNotify();
  const [blocks, setBlocks] = useState<TimeBlock[] | null>(null);
  const [contexts, setContexts] = useState<TaskContext[]>([]);
  const [editing, setEditing] = useState<TimeBlock | "new" | null>(null);

  const load = useCallback(() => {
    timeBlocksApi.list().then(setBlocks).catch(() => notify("Zeitblöcke konnten nicht geladen werden", "error"));
  }, [notify]);

  useEffect(() => { load(); listContexts().then(setContexts).catch(() => {}); }, [load]);

  const contextName = (id: string | null) => contexts.find((c) => c.id === id)?.name;
  const today = weekdayOf(new Date());
  const hoursOf = (day: Weekday) =>
    (blocks ?? []).filter((b) => b.weekday === day).reduce((sum, b) => sum + (b.endMinute - b.startMinute), 0) / 60;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1.5} mb={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <BlocksIcon color="primary" fontSize="large" />
          <Typography variant="h4">Zeitblöcke</Typography>
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>Neuer Block</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Feste Zeiten für bestimmte Arbeit – z. B. vormittags Deep Work am Computer, nachmittags Telefonate.
        Im Block zeigt „Passende Schritte“ genau die Nächsten Schritte, die jetzt reinpassen.
      </Typography>

      {!blocks ? <LinearProgress /> : (
        <>
          <TodayBlocks blocks={blocks} contexts={contexts} />
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" } }}>
            {WEEKDAYS.map((day) => {
              const dayBlocks = blocks.filter((b) => b.weekday === day);
              return (
                <Paper key={day} variant="outlined" sx={{ p: 1.5, borderColor: day === today ? "primary.main" : undefined }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={1}>
                    <Typography fontWeight={700}>{WEEKDAY_LABELS[day]}</Typography>
                    {dayBlocks.length > 0 && (
                      <Typography variant="caption" color="text.secondary">{hoursOf(day).toLocaleString("de-DE")} Std</Typography>
                    )}
                  </Stack>
                  {dayBlocks.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">Keine Blöcke</Typography>
                  ) : (
                    <Stack spacing={0.75}>
                      {dayBlocks.map((b) => (
                        <Stack key={b.id} direction="row" alignItems="center" spacing={1}>
                          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            {formatMinutes(b.startMinute)}–{formatMinutes(b.endMinute)}
                          </Typography>
                          <Box flex={1} minWidth={0}>
                            <Typography variant="body2" fontWeight={600} noWrap>{b.title}</Typography>
                            {(b.contextId || b.energy) && (
                              <Typography variant="caption" color="text.secondary" noWrap display="block">
                                {[contextName(b.contextId), b.energy && `Energie ${ENERGY_LABELS[b.energy]}`].filter(Boolean).join(" · ")}
                              </Typography>
                            )}
                          </Box>
                          <Tooltip title="Bearbeiten">
                            <IconButton size="small" onClick={() => setEditing(b)}><EditIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Paper>
              );
            })}
          </Box>
        </>
      )}

      {editing && (
        <BlockDialog block={editing} contexts={contexts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </Box>
  );
}
