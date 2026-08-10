import { useState } from "react";
import { Dialog, DialogTitle, DialogContent, TextField, Button, Stack, Typography, Alert } from "@mui/material";
import { Warning as WarningIcon } from "@mui/icons-material";

interface Props {
  open: boolean;
  openCount: number;
  totalCount: number;
  onClose: () => void;
  onConfirm: (note: string) => void;
}

export function ForceCompleteDialog({ open, openCount, totalCount, onClose, onConfirm }: Props) {
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <WarningIcon color="warning" />
        Aufgabe trotzdem erledigen?
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Alert severity="warning">
            {openCount} von {totalCount} Unteraufgaben sind noch nicht erledigt.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            Möchtest du die Aufgabe trotz offener Unteraufgaben als erledigt markieren?
          </Typography>
          <TextField
            label="Notiz (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            rows={2}
            fullWidth
          />
          <Stack direction="row" justifyContent="flex-end" gap={1}>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="contained" color="warning" onClick={() => onConfirm(note)}>
              Trotzdem erledigen
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
