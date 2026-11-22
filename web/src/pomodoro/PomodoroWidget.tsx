import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Autocomplete, Box, Button, ButtonBase, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Link, Stack, TextField, Tooltip, Typography, useMediaQuery, useTheme,
} from "@mui/material";
import {
  Timer as TimerIcon, PlayArrow as PlayIcon, Pause as PauseIcon, Stop as StopIcon,
  SkipNext as SkipIcon, CheckCircle as DoneIcon,
} from "@mui/icons-material";
import { completeTask, listTasks, updateTask } from "../api/tasksApi";
import { useNotify } from "../context/NotifyContext";
import { PHASE_LABELS, formatClock, usePomodoro, type PomodoroTask } from "./PomodoroContext";

/** Großes Timer-Fenster: Aufgabe wählen, starten/pausieren, Aufgabe erledigen. */
function PomodoroDialog({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const notify = useNotify();
  const p = usePomodoro();
  const [options, setOptions] = useState<PomodoroTask[]>([]);

  useEffect(() => {
    listTasks({ isCompleted: false, status: "next", pageSize: 100, sort: "dueAt", order: "asc" })
      .then((res) => setOptions(res.items.map((t) => ({ id: t.id, title: t.title, workMinutes: t.pomodoroMinutes }))))
      .catch(() => {});
  }, []);

  const isBreak = p.phase !== "work";
  const progress = p.totalMs ? 100 - (p.remainingMs / p.totalMs) * 100 : 0;
  const choices = p.task && !options.some((o) => o.id === p.task!.id) ? [p.task, ...options] : options;

  /** Eigene Fokus-Länge der gewählten Aufgabe ändern – gespeichert an der Aufgabe, gilt ab dem nächsten Fokus. */
  const [minutesDraft, setMinutesDraft] = useState("");
  useEffect(() => { setMinutesDraft(p.task?.workMinutes ? String(p.task.workMinutes) : ""); }, [p.task?.id, p.task?.workMinutes]);
  const saveTaskMinutes = async () => {
    if (!p.task) return;
    const n = minutesDraft.trim() === "" ? null : Math.round(Number(minutesDraft));
    if (n !== null && !(n >= 1 && n <= 180)) { notify("Bitte 1–180 Minuten angeben", "error"); return; }
    if (n === (p.task.workMinutes ?? null)) return;
    try {
      await updateTask(p.task.id, { pomodoroMinutes: n });
      const updated = { ...p.task, workMinutes: n };
      p.setTask(updated);
      setOptions((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      notify(n ? `„${p.task.title}“: ${n} Minuten pro Pomodoro` : `„${p.task.title}“ nutzt wieder deinen Standard`);
    } catch {
      notify("Länge konnte nicht gespeichert werden", "error");
    }
  };

  const finishTask = async () => {
    if (!p.task) return;
    try {
      const res = await completeTask(p.task.id);
      if (res.nextStep) {
        p.setTask(res.nextStep);
        notify(`Erledigt – weiter mit: ${res.nextStep.title}`);
      } else {
        p.setTask(null);
        notify("Aufgabe erledigt");
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { code?: string } } } };
      notify(err.response?.data?.error?.code === "SUBTASKS_OPEN"
        ? "Die Aufgabe hat noch offene Unteraufgaben – erledige sie in der Aufgabe selbst."
        : "Aufgabe konnte nicht erledigt werden", "error");
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" fullScreen={fullScreen}>
      <DialogTitle>Pomodoro</DialogTitle>
      <DialogContent>
        <Stack alignItems="center" spacing={2} mt={1}>
          <Box sx={{ position: "relative", display: "inline-flex" }}>
            <CircularProgress variant="determinate" value={100} size={200} thickness={2.5} sx={{ color: "action.hover" }} />
            <CircularProgress
              variant="determinate" value={progress} size={200} thickness={2.5}
              color={isBreak ? "success" : "secondary"} sx={{ position: "absolute", left: 0 }}
            />
            <Stack sx={{ position: "absolute", inset: 0 }} alignItems="center" justifyContent="center">
              <Typography variant="overline" color={isBreak ? "success.main" : "secondary.main"}>{PHASE_LABELS[p.phase]}</Typography>
              <Typography variant="h3" sx={{ fontVariantNumeric: "tabular-nums" }}>{formatClock(p.remainingMs)}</Typography>
            </Stack>
          </Box>

          <Autocomplete
            fullWidth
            options={choices}
            value={p.task}
            onChange={(_, v) => p.setTask(v)}
            getOptionLabel={(o) => o.title}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => <TextField {...params} label="Woran arbeitest du?" placeholder="Nächsten Schritt wählen (optional)" />}
            noOptionsText="Keine offenen Nächsten Schritte"
          />

          {p.task && (
            <TextField
              size="small" type="number" fullWidth label="Minuten pro Pomodoro für diese Aufgabe"
              value={minutesDraft} placeholder={`Standard: ${p.settings.workMinutes}`}
              onChange={(e) => setMinutesDraft(e.target.value)}
              onBlur={() => void saveTaskMinutes()}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              inputProps={{ min: 1, max: 180, inputMode: "numeric", enterKeyHint: "done" }}
              helperText={p.running && p.phase === "work" ? "Gilt ab dem nächsten Fokus" : "Leer = dein Standard"}
            />
          )}

          <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" useFlexGap>
            {!p.active && (
              <Button variant="contained" color="secondary" size="large" startIcon={<PlayIcon />} onClick={() => p.start()}>Start</Button>
            )}
            {p.running && <Button variant="contained" size="large" startIcon={<PauseIcon />} onClick={p.pause}>Pause</Button>}
            {p.active && !p.running && (
              <Button variant="contained" color="secondary" size="large" startIcon={<PlayIcon />} onClick={p.resume}>Fortsetzen</Button>
            )}
            {p.active && <Button startIcon={<SkipIcon />} onClick={p.skip}>{isBreak ? "Pause beenden" : "Überspringen"}</Button>}
            {p.active && <Button color="inherit" startIcon={<StopIcon />} onClick={p.stop}>Stopp</Button>}
          </Stack>

          {p.task && (
            <Button color="success" variant="outlined" startIcon={<DoneIcon />} onClick={finishTask}>
              „{p.task.title}“ erledigt
            </Button>
          )}

          <Typography variant="body2" color="text.secondary" textAlign="center">
            Heute: {p.completedToday} Pomodoro{p.completedToday === 1 ? "" : "s"} ·
            {" "}{p.task?.workMinutes ?? p.settings.workMinutes}/{p.settings.shortBreakMinutes}/{p.settings.longBreakMinutes} Min ·{" "}
            <Link component={RouterLink} to="/settings" onClick={onClose}>anpassen</Link>
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Schließen</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Kopfzeile: live Restzeit und aktuelle Aufgabe; Klick öffnet den Timer. */
export function PomodoroWidget() {
  const p = usePomodoro();
  const [open, setOpen] = useState(false);
  const isBreak = p.phase !== "work";

  return (
    <>
      {p.active ? (
        <Tooltip title={p.task ? `${PHASE_LABELS[p.phase]}: ${p.task.title}` : PHASE_LABELS[p.phase]}>
          <ButtonBase
            onClick={() => setOpen(true)}
            sx={{
              borderRadius: 4, px: 1.25, py: 0.5, gap: 0.75, color: "inherit",
              bgcolor: isBreak ? "rgba(76,175,80,0.35)" : "rgba(255,255,255,0.18)",
              opacity: p.running ? 1 : 0.7,
            }}
          >
            <TimerIcon fontSize="small" />
            <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: "tabular-nums" }}>
              {formatClock(p.remainingMs)}
            </Typography>
            {p.task && (
              <Typography variant="body2" noWrap sx={{ maxWidth: { xs: 0, sm: 140, md: 220 }, display: { xs: "none", sm: "block" } }}>
                {p.task.title}
              </Typography>
            )}
          </ButtonBase>
        </Tooltip>
      ) : (
        <Tooltip title="Pomodoro-Timer">
          <IconButton color="inherit" onClick={() => setOpen(true)}><TimerIcon /></IconButton>
        </Tooltip>
      )}
      {open && <PomodoroDialog onClose={() => setOpen(false)} />}
    </>
  );
}
