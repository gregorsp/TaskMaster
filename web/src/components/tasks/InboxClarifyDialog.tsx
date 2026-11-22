import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, TextField,
  Typography, LinearProgress, Box, Alert,
} from "@mui/material";
import {
  ArrowBack as BackIcon, Delete as TrashIcon, MenuBook as ReferenceIcon, Cloud as SomedayIcon,
  Bolt as DoNowIcon, HourglassTop as WaitingIcon, AccountTree as ProjectIcon, PlayArrow as NextIcon,
} from "@mui/icons-material";
import {
  listTasks, createTask, updateTask, deleteTask, completeTask, type Task,
} from "../../api/tasksApi";
import { listContexts, type TaskContext } from "../../api/contextsApi";
import { createNote, deleteNote } from "../../api/notesApi";
import { useNotify } from "../../context/NotifyContext";
import { GtdFields, type GtdValues } from "./GtdFields";
import { STATUS_LABELS } from "./gtd";

type Step = "actionable" | "not_actionable" | "how" | "next" | "waiting" | "project";

const EMPTY_GTD: GtdValues = { status: null, contexts: [] };

const QUESTIONS: Record<Step, string> = {
  actionable: "Ist es umsetzbar?",
  not_actionable: "Nicht umsetzbar – wohin damit?",
  how: "Was ist der nächste physische Schritt?",
  next: "Nächster Schritt – braucht es einen bestimmten Ort oder ein Werkzeug? (optional)",
  waiting: "Delegieren: Auf wen oder was wartest du?",
  project: "Mehr als ein Schritt – also ein Projekt. Was ist der erste Schritt?",
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Nach jeder Entscheidung, damit die Liste dahinter aktuell bleibt. */
  onChanged: () => void;
}

/** „Eingangskorb klären“ nach David Allen – ein Eintrag nach dem anderen. */
export function InboxClarifyDialog({ open, onClose, onChanged }: Props) {
  const notify = useNotify();
  const [queue, setQueue] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [contextOptions, setContextOptions] = useState<TaskContext[]>([]);

  const [step, setStep] = useState<Step>("actionable");
  const [title, setTitle] = useState("");
  const [gtd, setGtd] = useState<GtdValues>(EMPTY_GTD);
  const [waitingFor, setWaitingFor] = useState("");
  const [firstStep, setFirstStep] = useState("");

  const current = queue[0];

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listContexts().then(setContextOptions).catch(() => {});
    listTasks({ isCompleted: false, uncategorized: true, sort: "createdAt", order: "asc", pageSize: 100 })
      .then((res) => { setQueue(res.items); setTotal(res.items.length); })
      .catch(() => notify("Eingangskorb konnte nicht geladen werden", "error"))
      .finally(() => setLoading(false));
  }, [open, notify]);

  // Neuer Eintrag → Assistent von vorn.
  useEffect(() => {
    setStep("actionable");
    setTitle(current?.title ?? "");
    setGtd(EMPTY_GTD);
    setWaitingFor("");
    setFirstStep("");
  }, [current?.id]);

  /** Führt die Entscheidung aus und geht zum nächsten Eintrag. */
  const decide = async (action: () => Promise<unknown>, message: string) => {
    if (!current) return;
    setBusy(true);
    try {
      await action();
      notify(message);
      setQueue((q) => q.slice(1));
      onChanged();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { code?: string; message?: string } } } };
      const error = err.response?.data?.error;
      notify(error?.code === "FORBIDDEN"
        ? "Das darf nur, wer die Aufgabe erstellt hat – wähle einen anderen Weg."
        : error?.message || "Aktion fehlgeschlagen", "error");
    } finally {
      setBusy(false);
    }
  };

  const gtdPatch = () => ({
    contextIds: gtd.contexts.map((c) => c.id),
  });
  const cleanTitle = title.trim() || current?.title || "";

  /**
   * Referenzmaterial gehört in die Notizen, nicht in die Aufgabenlisten:
   * Notiz anlegen, dann die Aufgabe löschen. Scheitert das Löschen (z. B. nur
   * zugewiesen, nicht selbst erstellt), wird die Notiz wieder entfernt.
   */
  const moveToNotes = async (task: Task) => {
    const note = await createNote({
      kind: "text",
      title: cleanTitle.slice(0, 200),
      body: task.description?.trim() || cleanTitle,
    });
    try {
      await deleteTask(task.id);
    } catch (e) {
      await deleteNote(note.id).catch(() => {});
      throw e;
    }
  };

  const skip = () => setQueue((q) => (q.length > 1 ? [...q.slice(1), q[0]] : q));

  const choice = (label: string, icon: ReactNode, onClick: () => void, color: "primary" | "error" | "secondary" | "success" | "warning" = "primary") => (
    <Button variant="outlined" color={color} startIcon={icon} onClick={onClick} disabled={busy}
      sx={{ justifyContent: "flex-start", textTransform: "none", py: 1.2 }}>
      {label}
    </Button>
  );

  const done = total - queue.length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Eingangskorb klären</DialogTitle>
      <DialogContent>
        {loading ? (
          <LinearProgress />
        ) : !current ? (
          <Alert severity="success">
            Der Eingangskorb ist leer{total > 0 ? ` – ${total} Eintrag/Einträge geklärt` : ""}. Kopf frei!
          </Alert>
        ) : (
          <Stack spacing={2} mt={0.5}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Eintrag {done + 1} von {total}
              </Typography>
              <LinearProgress variant="determinate" value={total ? (done / total) * 100 : 0} sx={{ mt: 0.5 }} />
            </Box>

            <TextField
              label="Eintrag" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth
              helperText="Tipp: Formuliere ihn als konkrete, sichtbare Handlung."
            />
            {current.description && (
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                {current.description}
              </Typography>
            )}

            <Typography variant="subtitle1" fontWeight={600}>{QUESTIONS[step]}</Typography>

            {step === "actionable" && (
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={() => setStep("how")} disabled={busy}>Ja</Button>
                <Button variant="outlined" onClick={() => setStep("not_actionable")} disabled={busy}>Nein</Button>
              </Stack>
            )}

            {step === "not_actionable" && (
              <Stack spacing={1}>
                {choice("Papierkorb – wird nicht gebraucht", <TrashIcon />, () =>
                  decide(() => deleteTask(current.id), "Gelöscht"), "error")}
                {choice("Referenz – als Notiz aufbewahren", <ReferenceIcon />, () =>
                  decide(() => moveToNotes(current), "Als Notiz abgelegt"))}
                {choice(`${STATUS_LABELS.someday} – vielleicht später`, <SomedayIcon />, () =>
                  decide(() => updateTask(current.id, { title: cleanTitle, status: "someday" }), "Auf Irgendwann/Vielleicht gelegt"), "secondary")}
              </Stack>
            )}

            {step === "how" && (
              <Stack spacing={1}>
                {choice("Dauert unter 2 Minuten – jetzt sofort erledigen", <DoNowIcon />, () =>
                  decide(async () => {
                    if (cleanTitle !== current.title) await updateTask(current.id, { title: cleanTitle });
                    await completeTask(current.id);
                  }, "Erledigt – sehr gut!"), "success")}
                {choice("Jemand anderes soll es tun – delegieren", <WaitingIcon />, () => setStep("waiting"), "warning")}
                {choice("Mehrere Schritte nötig – Projekt anlegen", <ProjectIcon />, () => setStep("project"))}
                {choice("Ein einzelner Schritt – als Nächsten Schritt einsortieren", <NextIcon />, () => setStep("next"))}
              </Stack>
            )}

            {step === "next" && (
              <GtdFields value={gtd} onChange={(p) => setGtd((v) => ({ ...v, ...p }))} contextOptions={contextOptions} hideStatus />
            )}

            {step === "waiting" && (
              <TextField
                label="Warten auf (Person / Sache)" value={waitingFor} autoFocus fullWidth
                onChange={(e) => setWaitingFor(e.target.value)}
                placeholder="z. B. Angebot von Herrn Meier"
              />
            )}

            {step === "project" && (
              <>
                <Typography variant="body2" color="text.secondary">
                  Der Eintrag oben wird zum Projekt (gewünschtes Ergebnis). Lege den ersten Nächsten Schritt an:
                </Typography>
                <TextField
                  label="Erster Nächster Schritt" value={firstStep} autoFocus fullWidth
                  onChange={(e) => setFirstStep(e.target.value)}
                />
                <GtdFields value={gtd} onChange={(p) => setGtd((v) => ({ ...v, ...p }))} contextOptions={contextOptions} hideStatus />
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        {current && step !== "actionable" && (
          <Button startIcon={<BackIcon />} disabled={busy}
            onClick={() => setStep(step === "not_actionable" || step === "how" ? "actionable" : "how")}>
            Zurück
          </Button>
        )}
        {current && queue.length > 1 && <Button onClick={skip} disabled={busy}>Überspringen</Button>}
        <Box sx={{ flex: 1 }} />
        {current && step === "next" && (
          <Button variant="contained" disabled={busy || !cleanTitle}
            onClick={() => decide(() => updateTask(current.id, { title: cleanTitle, status: "next", ...gtdPatch() }), "Als Nächster Schritt einsortiert")}>
            Einsortieren
          </Button>
        )}
        {current && step === "waiting" && (
          <Button variant="contained" disabled={busy || !waitingFor.trim()}
            onClick={() => decide(() => updateTask(current.id, {
              title: cleanTitle,
              status: "waiting",
              description: [`Warten auf: ${waitingFor.trim()}`, current.description].filter(Boolean).join("\n\n"),
            }), "Auf „Warten auf“ gesetzt")}>
            Delegieren
          </Button>
        )}
        {current && step === "project" && (
          <Button variant="contained" disabled={busy || !firstStep.trim()}
            onClick={() => decide(async () => {
              if (cleanTitle !== current.title) await updateTask(current.id, { title: cleanTitle });
              await createTask({ title: firstStep.trim(), parentId: current.id, status: "next", ...gtdPatch() });
            }, "Projekt mit erstem Nächsten Schritt angelegt")}>
            Projekt anlegen
          </Button>
        )}
        <Button onClick={onClose}>{current ? "Später weiter" : "Schließen"}</Button>
      </DialogActions>
    </Dialog>
  );
}
