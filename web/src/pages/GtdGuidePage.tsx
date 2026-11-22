import { useEffect, useState } from "react";
import {
  Box, Typography, Paper, Stack, Chip, Divider, Accordion,
  AccordionSummary, AccordionDetails,
} from "@mui/material";
import { CheckCircleOutline as GtdIcon, ExpandMore as ExpandMoreIcon } from "@mui/icons-material";
import { TaskListPane } from "../components/tasks/TaskListPane";
import { listContexts, type TaskContext } from "../api/contextsApi";
import { STATUS_LABELS } from "../components/tasks/gtd";

const STEPS = [
  {
    title: "1. Sammeln (Capture)",
    desc: "Tippe auf jeder Seite oben auf das Eingangskorb-Symbol (oder nutze das Feld im Eingangskorb) und schreib jeden Gedanken auf – Enter genügt. Nichts muss sofort sortiert werden; Hauptsache, es ist aus dem Kopf.",
  },
  {
    title: "2. Klären (Clarify)",
    desc: `Starte „Eingangskorb klären“. Der Assistent fragt pro Eintrag: Ist es umsetzbar? Nein → Papierkorb, ${STATUS_LABELS.someday} oder als Referenz in die Notizen. Ja → unter 2 Minuten sofort erledigen, delegieren („${STATUS_LABELS.waiting}“), als Projekt mit erstem Schritt anlegen oder als ${STATUS_LABELS.next} einsortieren.`,
  },
  {
    title: "3. Organisieren (Organize)",
    desc: "Nächste Schritte bekommen eine Dauer, den Energiebedarf und bei Bedarf einen Kontext (wo/womit). Projekte sind Aufgaben mit Unteraufgaben – sie entstehen automatisch, sobald ein erster Schritt angehängt wird. Schreib die Schritte einfach der Reihe nach als Unteraufgaben auf: Der erste wird Nächster Schritt, und sobald er erledigt ist, rückt der nächste automatisch nach.",
  },
  {
    title: "4. Reflektieren (Weekly Review)",
    desc: `Einmal pro Woche „Weekly Review“ öffnen: Eingangskorb leeren, festgefahrenen Projekten direkt einen Nächsten Schritt geben, „${STATUS_LABELS.waiting}“ abhaken oder nachfassen, Ziele ohne Bewegung prüfen, ${STATUS_LABELS.someday} durchsehen und die nächste Woche im Planungsraster verteilen.`,
  },
  {
    title: "5. Erledigen (Engage)",
    desc: "Filtere oben nach verfügbarer Zeit, deiner Energie und der Priorität, bei Bedarf auch nach Kontext – übrig bleiben genau die Schritte, die jetzt passen. Mit Zeitblöcken (GTD → Zeitblöcke) geht das auf Knopfdruck: „Passende Schritte“ filtert automatisch für den laufenden Block.",
  },
  {
    title: "Ziele (Horizont über den Projekten)",
    desc: "Unter GTD → Ziele legst du fest, wofür du arbeitest. Hänge Projekte an ein Ziel (Feld „Ziel“ in der Aufgabe oder direkt auf der Ziel-Seite) – dort siehst du Fortschritt und Nächsten Schritt jedes Projekts.",
  },
  {
    title: "Brainstorming & Mindmaps",
    desc: "Für komplexe Vorhaben das Brainstorming-Board nutzen: Die Wurzel wird zum Projekt, die Äste werden seine Schritte – der erste ist sofort Nächster Schritt, die anderen rücken nach.",
  },
];

export function GtdGuidePage() {
  const [guideOpen, setGuideOpen] = useState(false);
  const [contexts, setContexts] = useState<TaskContext[]>([]);

  useEffect(() => {
    if (guideOpen && contexts.length === 0) listContexts().then(setContexts).catch(() => {});
  }, [guideOpen, contexts.length]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
        <GtdIcon color="primary" fontSize="large" />
        <Typography variant="h4">Getting Things Done (GTD)</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Die Selbstmanagement-Methode nach David Allen: Sammeln → Klären → Organisieren → Reflektieren → Erledigen.
      </Typography>

      <TaskListPane title="Aufgaben" showGtdTabs showWeeklyReview />

      <Accordion expanded={guideOpen} onChange={(_, open) => setGuideOpen(open)} sx={{ mt: 3 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle1" fontWeight={600}>GTD-Anleitung & Kontexte</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            {STEPS.map((s) => (
              <Paper key={s.title} variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
                <Typography variant="h6" color="primary" gutterBottom>{s.title}</Typography>
                <Typography variant="body2" color="text.secondary">{s.desc}</Typography>
              </Paper>
            ))}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>Deine Kontexte</Typography>
              <Divider sx={{ mb: 1.5 }} />
              <Stack direction="row" flexWrap="wrap" gap={1} mb={1.5}>
                {contexts.map((ctx) => (
                  <Chip key={ctx.id} label={ctx.name} variant="outlined" sx={{ borderColor: ctx.color, color: ctx.color }} />
                ))}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Eigene Kontexte legst du unter „Kontexte“ an – sie erscheinen als Badge an der Aufgabe und oben als Filter.
              </Typography>
            </Paper>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
