import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { useNotify } from "../../context/NotifyContext";
import { deleteModel, downloadModel, getModelStatus, type ModelProgress } from "../../asr/modelStore";
import { runAllTranscriptionJobs, transcriptionCapability } from "../../asr/transcription";

interface Props {
  onDone: () => void;
}

/**
 * Modellverwaltung und manueller Anstoß. Die eigentliche Arbeit macht der
 * Hintergrund-Läufer; hier wird nur eingerichtet, was fehlt.
 */
export function TranscribeControl({ onDone }: Props) {
  const notify = useNotify();
  const [ready, setReady] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<ModelProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const capability = transcriptionCapability();

  useEffect(() => {
    getModelStatus()
      .then((status) => setReady(status.ready))
      .catch(() => setReady(false));
  }, []);

  const setup = async () => {
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    try {
      await downloadModel((progress) => setDownload(progress));
      setReady(true);
      notify("Sprachmodell eingerichtet — die Transkription läuft jetzt automatisch");
      onDone();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
      setDownload(null);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const processed = await runAllTranscriptionJobs();
      notify(processed > 0 ? `${processed} Transkription${processed === 1 ? "" : "en"} erstellt` : "Keine offenen Aufnahmen");
      onDone();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      {ready === false && (
        <Button variant="contained" size="small" onClick={() => setConfirmOpen(true)} disabled={busy}>
          Sprachmodell einrichten (~670 MB)
        </Button>
      )}

      {ready && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="caption" color="text.secondary">
            Transkription läuft automatisch im Hintergrund, solange die App offen ist.
          </Typography>
          <Button size="small" variant="outlined" onClick={runNow} disabled={busy}>
            Jetzt verarbeiten
          </Button>
          <Button
            size="small"
            color="inherit"
            disabled={busy}
            onClick={async () => {
              await deleteModel();
              setReady(false);
              notify("Modell gelöscht");
            }}
          >
            Modell löschen
          </Button>
        </Stack>
      )}

      {!capability.threads && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          Keine Cross-Origin-Isolation: die Transkription läuft einthreadig und ist deutlich langsamer.
        </Typography>
      )}

      {busy && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress
            variant={download ? "determinate" : "indeterminate"}
            value={download && download.totalBytes > 0 ? (download.receivedBytes / download.totalBytes) * 100 : 0}
          />
          <Typography variant="caption" color="text.secondary">
            {download
              ? `Modell wird geladen: ${(download.receivedBytes / 1_000_000).toFixed(1)} MB${
                  download.totalBytes > 0 ? ` von ${(download.totalBytes / 1_000_000).toFixed(0)} MB` : ""
                }`
              : "Transkription läuft…"}
          </Typography>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Sprachmodell einrichten</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography variant="body2">
              Für die Transkription wird einmalig ein Sprachmodell (Parakeet TDT, ca. 670 MB) auf dieses Gerät
              geladen. Es läuft danach vollständig lokal — die Aufnahme verlässt dein Gerät nicht.
            </Typography>
            <Alert severity="info">
              Der Tab muss während der Berechnung geöffnet bleiben. Auf Mobilgeräten kann das Modell den Browser an
              die Speichergrenze bringen.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Abbrechen</Button>
          <Button variant="contained" onClick={setup}>
            Herunterladen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
