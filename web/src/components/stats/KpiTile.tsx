import { Paper, Typography } from "@mui/material";

export interface KpiDelta {
  text: string;
  good: boolean | null;
}

interface Props {
  label: string;
  value: string;
  hint?: string;
  delta?: KpiDelta | null;
}

/** Kennzahlen-Kachel mit optionalem Vergleich zur Vorperiode. */
export function KpiTile({ label, value, hint, delta }: Props) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: "1 1 150px", minWidth: 140 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={600}>
        {value}
      </Typography>
      {delta && (
        <Typography
          variant="caption"
          display="block"
          sx={{ color: delta.good === null ? "text.secondary" : delta.good ? "success.main" : "error.main" }}
        >
          {delta.text}
        </Typography>
      )}
      {hint && (
        <Typography variant="caption" color="text.secondary" display="block">
          {hint}
        </Typography>
      )}
    </Paper>
  );
}
