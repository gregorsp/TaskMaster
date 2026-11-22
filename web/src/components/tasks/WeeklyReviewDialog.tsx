import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Typography,
  LinearProgress, Paper, IconButton, Tooltip, Chip, Alert, Divider, useMediaQuery, useTheme,
} from "@mui/material";
import { Check as DoneIcon, Replay as FollowUpIcon } from "@mui/icons-material";
import { getWeeklyReview, completeTask, updateTask, type WeeklyReview } from "../../api/tasksApi";
import { useNotify } from "../../context/NotifyContext";
import { STATUS_LABELS } from "./gtd";
import { NextStepInput } from "./NextStepInput";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** Öffnet den Klär-Assistenten für den Eingangskorb. */
  onClarifyInbox: () => void;
  /** Springt zur Irgendwann/Vielleicht-Liste. */
  onShowSomeday: () => void;
}

function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/** Abschnitt mit Überschrift; `summary` + `action` brechen auf schmalen Bildschirmen um. */
function Section({ title, summary, action, children }: { title: string; summary?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <section>
      <Typography variant="h6" gutterBottom>{title}</Typography>
      {(summary || action) && (
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap mb={children ? 1 : 0}>
          {summary && <Typography sx={{ flex: "1 1 220px" }}>{summary}</Typography>}
          {action}
        </Stack>
      )}
      {children}
    </section>
  );
}

/**
 * Interaktiver GTD Weekly Review: Eingangskorb, Projekte, Warten auf, Ziele,
 * Irgendwann/Vielleicht und die Wochenplanung.
 */
export function WeeklyReviewDialog({ open, onClose, onChanged, onClarifyInbox, onShowSomeday }: Props) {
  const notify = useNotify();
  const navigate = useNavigate();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [review, setReview] = useState<WeeklyReview | null>(null);

  const load = useCallback(() => {
    getWeeklyReview().then(setReview).catch(() => notify("Weekly Review konnte nicht geladen werden", "error"));
  }, [notify]);

  useEffect(() => { if (open) { setReview(null); load(); } }, [open, load]);

  const refresh = () => { load(); onChanged(); };

  const act = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      notify(message);
      refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      notify(err.response?.data?.error?.message || "Aktion fehlgeschlagen", "error");
    }
  };

  const goTo = (path: string) => { onClose(); navigate(path); };
  const allClear = review && review.inboxCount === 0 && review.stalledProjects.length === 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={fullScreen}>
      <DialogTitle>Weekly Review</DialogTitle>
      <DialogContent dividers>
        {!review ? <LinearProgress /> : (
          <Stack spacing={3} divider={<Divider />}>
            {allClear && <Alert severity="success">Eingangskorb leer und jedes Projekt hat einen Nächsten Schritt.</Alert>}

            <Section
              title="1. Eingangskorb leeren"
              summary={review.inboxCount === 0 ? "Nichts Ungeklärtes." : `${review.inboxCount} ungeklärte(r) Eintrag/Einträge.`}
              action={review.inboxCount > 0 && <Button variant="contained" color="warning" onClick={onClarifyInbox}>Jetzt klären</Button>}
            />

            <Section
              title={`2. Projekte ohne Nächsten Schritt (${review.stalledProjects.length})`}
              summary={review.stalledProjects.length === 0 && "Jedes Projekt hat mindestens einen offenen Nächsten Schritt."}
            >
              <Stack spacing={1}>
                {review.stalledProjects.map((p) => (
                  <Paper key={p.id} variant="outlined" sx={{ p: 1.5 }}>
                    <Typography fontWeight={600} gutterBottom sx={{ overflowWrap: "anywhere" }}>{p.title}</Typography>
                    <NextStepInput parentId={p.id} onAdded={refresh} />
                  </Paper>
                ))}
              </Stack>
            </Section>

            <Section
              title={`3. ${STATUS_LABELS.waiting} prüfen (${review.waiting.length})`}
              summary={review.waiting.length === 0 && "Du wartest auf nichts."}
            >
              <Stack spacing={1}>
                {review.waiting.map((t) => {
                  const days = daysSince(t.createdAt);
                  return (
                    <Paper key={t.id} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Stack flex={1} minWidth={0}>
                          <Typography fontWeight={600} noWrap>{t.title}</Typography>
                          {t.description && (
                            <Typography variant="body2" color="text.secondary" noWrap>{t.description.split("\n")[0]}</Typography>
                          )}
                        </Stack>
                        <Chip size="small" color={days >= 7 ? "warning" : "default"} label={days === 0 ? "heute" : `${days} T.`} />
                        <Tooltip title="Ist eingetroffen – erledigt">
                          <IconButton color="success" onClick={() => act(() => completeTask(t.id), "Erledigt")}>
                            <DoneIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Nachfassen – wird zum Nächsten Schritt">
                          <IconButton color="primary" onClick={() => act(() => updateTask(t.id, { status: "next" }), "Nachfassen als Nächster Schritt eingeplant")}>
                            <FollowUpIcon />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            </Section>

            <Section
              title={`4. Ziele ohne Bewegung (${review.idleGoals.length})`}
              summary={review.idleGoals.length === 0
                ? "An jedem offenen Ziel hängt mindestens eine offene Aufgabe."
                : "Zu diesen Zielen ist gerade nichts in Arbeit – Projekt anlegen, verschieben oder als erreicht markieren?"}
              action={<Button variant="outlined" onClick={() => goTo("/gtd/goals")}>Zu den Zielen</Button>}
            >
              {review.idleGoals.length > 0 && (
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  {review.idleGoals.map((g) => <Chip key={g.id} label={g.title} variant="outlined" color="warning" />)}
                </Stack>
              )}
            </Section>

            <Section
              title={`5. ${STATUS_LABELS.someday} durchsehen`}
              summary={`${review.somedayCount} Eintrag/Einträge – ist etwas davon jetzt dran?`}
              action={review.somedayCount > 0 && <Button variant="outlined" onClick={onShowSomeday}>Liste öffnen</Button>}
            />

            <Section
              title="6. Nächste Woche planen"
              summary="Verteile deine Nächsten Schritte auf feste Tage – die Kapazität rechnet mit Pomodoros oder ersatzweise mit der geschätzten Dauer. Feste Zeitblöcke legst du unter GTD → Zeitblöcke an."
              action={<Button variant="outlined" onClick={() => goTo("/plan")}>Zur Planung</Button>}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fertig</Button>
      </DialogActions>
    </Dialog>
  );
}
