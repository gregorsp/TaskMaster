import { useCallback, useEffect, useState } from "react";
import {
  Box, Typography, Stack, Button, Paper, Chip, LinearProgress, IconButton, Tooltip, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, Switch, Collapse, Alert,
  useMediaQuery, useTheme,
} from "@mui/material";
import {
  Flag as GoalIcon, Add as AddIcon, Edit as EditIcon, ExpandMore as ExpandIcon, ExpandLess as CollapseIcon,
} from "@mui/icons-material";
import { goalsApi, type Goal, type GoalInput } from "../api/horizonsApi";
import { createTask } from "../api/tasksApi";
import { useNotify } from "../context/NotifyContext";
import { useModalStack } from "../components/tasks/ModalStackProvider";
import { NextStepInput } from "../components/tasks/NextStepInput";
import { STATUS_LABELS } from "../components/tasks/gtd";

const toInputDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Anlegen/Bearbeiten eines Ziels (auf dem Handy im Vollbild). */
function GoalDialog({ goal, onClose, onSaved }: { goal: Goal | "new"; onClose: () => void; onSaved: () => void }) {
  const notify = useNotify();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const existing = goal === "new" ? null : goal;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [targetDate, setTargetDate] = useState(toInputDate(existing?.targetDate ?? null));
  const [achieved, setAchieved] = useState(!!existing?.achievedAt);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    const input: GoalInput = {
      title: title.trim(),
      description: description.trim() || null,
      targetDate: targetDate ? new Date(`${targetDate}T12:00:00`).toISOString() : null,
    };
    try {
      if (existing) await goalsApi.update(existing.id, { ...input, achieved });
      else await goalsApi.create(input);
      notify(existing ? "Ziel gespeichert" : "Ziel angelegt");
      onSaved();
    } catch {
      notify("Ziel konnte nicht gespeichert werden", "error");
    }
  };

  const remove = async () => {
    if (!existing) return;
    try {
      await goalsApi.remove(existing.id);
      notify("Ziel gelöscht – verknüpfte Aufgaben bleiben erhalten");
      onSaved();
    } catch {
      notify("Ziel konnte nicht gelöscht werden", "error");
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle>{existing ? "Ziel bearbeiten" : "Neues Ziel"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <TextField label="Ziel" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus fullWidth
            helperText="Ein Ergebnis, kein Tun – z. B. „Bachelorarbeit abgegeben“ oder „Fit für den Halbmarathon“." />
          <TextField label="Warum ist es mir wichtig? (optional)" value={description} onChange={(e) => setDescription(e.target.value)}
            multiline minRows={2} fullWidth />
          <TextField label="Bis wann? (optional)" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
            InputLabelProps={{ shrink: true }} fullWidth />
          {existing && (
            <FormControlLabel control={<Switch checked={achieved} onChange={(e) => setAchieved(e.target.checked)} />} label="Erreicht" />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        {existing && (confirmDelete
          ? <Button color="error" variant="contained" onClick={remove}>Wirklich löschen</Button>
          : <Button color="error" onClick={() => setConfirmDelete(true)}>Löschen</Button>)}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={save} disabled={!title.trim()}>Speichern</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Eingabezeile „Neues Projekt für dieses Ziel“. */
function AddGoalTask({ goalId, onAdded }: { goalId: string; onAdded: () => void }) {
  const notify = useNotify();
  const [text, setText] = useState("");
  const submit = async () => {
    if (!text.trim()) return;
    try {
      await createTask({ title: text.trim(), goalId });
      setText("");
      onAdded();
    } catch {
      notify("Konnte nicht angelegt werden", "error");
    }
  };
  return (
    <TextField
      size="small" fullWidth placeholder="Projekt oder Aufgabe für dieses Ziel … (Enter)"
      value={text} onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
      inputProps={{ enterKeyHint: "done" }}
    />
  );
}

function GoalCard({ goal, onEdit, onChanged }: { goal: Goal; onEdit: () => void; onChanged: () => void }) {
  const { push } = useModalStack();
  const total = goal.openCount + goal.doneCount;
  const overdue = !goal.achievedAt && goal.targetDate && new Date(goal.targetDate) < new Date();
  const openTasks = goal.tasks.filter((t) => !t.isCompleted);

  return (
    <Paper variant="outlined" sx={{ p: 2, opacity: goal.achievedAt ? 0.7 : 1 }}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box flex={1} minWidth={0}>
          <Typography variant="h6" sx={{ overflowWrap: "anywhere", textDecoration: goal.achievedAt ? "line-through" : undefined }}>
            {goal.title}
          </Typography>
          {goal.description && <Typography variant="body2" color="text.secondary">{goal.description}</Typography>}
        </Box>
        <Tooltip title="Bearbeiten"><IconButton onClick={onEdit}><EditIcon /></IconButton></Tooltip>
      </Stack>

      <Stack direction="row" flexWrap="wrap" gap={1} my={1}>
        {goal.targetDate && (
          <Chip size="small" color={overdue ? "error" : "default"} variant="outlined" label={`bis ${formatDate(goal.targetDate)}`} />
        )}
        {goal.achievedAt && <Chip size="small" color="success" label={`erreicht am ${formatDate(goal.achievedAt)}`} />}
        {!goal.achievedAt && goal.openCount === 0 && <Chip size="small" color="warning" label="Nichts in Arbeit" />}
        {total > 0 && <Chip size="small" variant="outlined" label={`${goal.doneCount}/${total} erledigt`} />}
      </Stack>
      {total > 0 && <LinearProgress variant="determinate" value={(goal.doneCount / total) * 100} sx={{ mb: 1.5, borderRadius: 1 }} />}

      {!goal.achievedAt && (
        <Stack spacing={1.5}>
          {openTasks.map((t) => {
            const needsStep = !t.nextStep && (t.isProject || !t.status);
            return (
              <Box key={t.id}>
                <Typography
                  fontWeight={600} onClick={() => push({ id: t.id, title: t.title })}
                  sx={{ cursor: "pointer", overflowWrap: "anywhere", "&:hover": { textDecoration: "underline" } }}
                >
                  {t.title}
                  {!t.isProject && t.status && (
                    <Typography component="span" variant="caption" color="text.secondary"> · {STATUS_LABELS[t.status]}</Typography>
                  )}
                </Typography>
                {t.nextStep && (
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>→ {t.nextStep.title}</Typography>
                )}
                {needsStep && (
                  <Box mt={0.5}>
                    <NextStepInput parentId={t.id} placeholder="Erster/nächster Schritt …" onAdded={onChanged} />
                  </Box>
                )}
              </Box>
            );
          })}
          <AddGoalTask goalId={goal.id} onAdded={onChanged} />
        </Stack>
      )}
    </Paper>
  );
}

/**
 * GTD-Horizont über den Projekten: Wofür arbeite ich? Jedes Ziel zeigt seine
 * Projekte samt Nächstem Schritt; Ziele ohne laufende Aufgabe fallen auf.
 */
export function GoalsPage() {
  const notify = useNotify();
  const { setOnRootUpdated } = useModalStack();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [showAchieved, setShowAchieved] = useState(false);

  const load = useCallback(() => {
    goalsApi.list().then(setGoals).catch(() => notify("Ziele konnten nicht geladen werden", "error"));
  }, [notify]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOnRootUpdated(load); }, [load, setOnRootUpdated]);

  const open = goals?.filter((g) => !g.achievedAt) ?? [];
  const achieved = goals?.filter((g) => g.achievedAt) ?? [];

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1.5} mb={1}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <GoalIcon color="primary" fontSize="large" />
          <Typography variant="h4">Ziele</Typography>
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>Neues Ziel</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Ziele sind die Ebene über deinen Projekten. Hänge Projekte an ein Ziel – hier siehst du, ob es vorangeht
        und was der nächste Schritt ist.
      </Typography>

      {!goals ? <LinearProgress /> : (
        <Stack spacing={2}>
          {open.length === 0 && (
            <Alert severity="info">Noch keine offenen Ziele. Lege eines an und hänge Projekte daran – auch über das Feld „Ziel“ in jeder Aufgabe.</Alert>
          )}
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
            {open.map((g) => <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} onChanged={load} />)}
          </Box>

          {achieved.length > 0 && (
            <Box>
              <Button onClick={() => setShowAchieved((v) => !v)} endIcon={showAchieved ? <CollapseIcon /> : <ExpandIcon />}>
                Erreichte Ziele ({achieved.length})
              </Button>
              <Collapse in={showAchieved}>
                <Box sx={{ display: "grid", gap: 2, mt: 1, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
                  {achieved.map((g) => <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} onChanged={load} />)}
                </Box>
              </Collapse>
            </Box>
          )}
        </Stack>
      )}

      {editing && (
        <GoalDialog goal={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </Box>
  );
}
