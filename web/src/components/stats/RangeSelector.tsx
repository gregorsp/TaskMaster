import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { StatsRangePreset, StatsRangeSelection } from "../../api/statsApi";

const PRESETS: { value: StatsRangePreset; label: string }[] = [
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
  { value: "90d", label: "90 Tage" },
  { value: "week", label: "Woche" },
  { value: "month", label: "Monat" },
  { value: "quarter", label: "Quartal" },
];

function localDateInput(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface Props {
  value: StatsRangeSelection;
  onChange: (value: StatsRangeSelection) => void;
}

/** Globale Zeitraumwahl – gilt für alle Sektionen der Statistik-Seite. */
export function RangeSelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from ?? localDateInput(-29));
  const [to, setTo] = useState(value.to ?? localDateInput(0));

  const openDialog = () => {
    setFrom(value.from ?? localDateInput(-29));
    setTo(value.to ?? localDateInput(0));
    setOpen(true);
  };

  const apply = () => {
    if (!from || !to || from > to) return;
    onChange({ preset: "custom", from, to });
    setOpen(false);
  };

  return (
    <>
      <Stack direction="row" gap={1} flexWrap="wrap" useFlexGap alignItems="center">
        <ToggleButtonGroup
          size="small"
          exclusive
          value={value.preset === "custom" ? null : value.preset}
          onChange={(_event, next: StatsRangePreset | null) => next && onChange({ preset: next })}
        >
          {PRESETS.map((preset) => (
            <ToggleButton key={preset.value} value={preset.value}>
              {preset.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button
          size="small"
          variant={value.preset === "custom" ? "contained" : "outlined"}
          onClick={openDialog}
        >
          {value.preset === "custom" && value.from && value.to
            ? `${value.from} – ${value.to}`
            : "Zeitraum…"}
        </Button>
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Zeitraum wählen</DialogTitle>
        <DialogContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Von"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              label="Bis"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Stack>
          {from && to && from > to && (
            <Typography color="error" variant="caption">
              „Von“ muss vor „Bis“ liegen.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button variant="contained" onClick={apply} disabled={!from || !to || from > to}>
            Anwenden
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
