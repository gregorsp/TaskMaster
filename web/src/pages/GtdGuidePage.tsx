import { Box, Typography, Paper, Stack, Chip, Divider, Button } from "@mui/material";
import { CheckCircleOutline as GtdIcon, ArrowForward as ArrowIcon } from "@mui/icons-material";
import { useNavigate } from "react-router-dom";

export function GtdGuidePage() {
  const navigate = useNavigate();

  const steps = [
    {
      title: "1. Erfassen (Capture)",
      desc: "Sammle alles, was deine Aufmerksamkeit bindet, sofort in TaskMaster (+ Neue Aufgabe). Aufgaben ohne Kategorie landen automatisch im Eingangskorb, damit dein Kopf frei bleibt.",
    },
    {
      title: "2. Klären (Clarify) & Die 2-Minuten-Regel",
      desc: "Prüfe jeden Eintrag im Eingangskorb: „Was ist der allererste physische Schritt?“ Dauert er unter 2 Minuten, erledige ihn sofort. Braucht ein Ziel mehrere Schritte, lege ein Projekt plus mindestens einen konkreten Nächsten Schritt an.",
    },
    {
      title: "3. Organisieren (Organize) & Kontexte",
      desc: "Ordne geklärte Aufgaben den GTD-Listen zu (Projekte, Nächste Schritte, Warten auf, Irgendwann/Vielleicht) und nutze Kontext-Tags wie @Telefon, @Computer, @Online, @Zuhause, @Besorgungen oder @Uni.",
    },
    {
      title: "4. Brainstorming & Mindmaps (Natürliches Planen)",
      desc: "Für komplexe Vorhaben nutze das Brainstorming-Board im Menü. Sammle frei alle Äste, verknüpfe Gedanken und schiebe umsetzbare Ideen per Pfeil (→) direkt in deine Nächsten Schritte.",
    },
    {
      title: "5. Reflektieren (Weekly Review)",
      desc: "Klicke einmal pro Woche in der Aufgabenansicht oben rechts auf „Weekly Review“. So stellst du sicher, dass der Eingangskorb leer ist und jedes aktive Projekt mindestens einen offenen Nächsten Schritt besitzt.",
    },
  ];

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2} mb={2}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <GtdIcon color="primary" fontSize="large" />
          <Typography variant="h4">Getting Things Done (GTD)</Typography>
        </Stack>
        <Button variant="contained" endIcon={<ArrowIcon />} onClick={() => navigate("/")}>
          Zu meinen Aufgaben
        </Button>
      </Stack>

      <Typography variant="body1" color="text.secondary" mb={3}>
        Die Selbstmanagement-Methode nach David Allen – integriert in TaskMaster für stressfreie Produktivität.
      </Typography>

      <Stack spacing={2} mb={3}>
        {steps.map((s) => (
          <Paper key={s.title} variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
            <Typography variant="h6" color="primary" gutterBottom>
              {s.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {s.desc}
            </Typography>
          </Paper>
        ))}
      </Stack>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Verfügbare GTD-Kontexte in TaskMaster
        </Typography>
        <Divider sx={{ mb: 1.5 }} />
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {["@Telefon", "@Computer", "@Online", "@Zuhause", "@Besorgungen", "@Uni"].map((ctx) => (
            <Chip key={ctx} label={ctx} color="primary" variant="outlined" />
          ))}
        </Stack>
      </Paper>
    </Box>
  );
}