import { useState, useEffect } from "react";
import { MenuItem, TextField, FormControlLabel, Checkbox, Typography } from "@mui/material";
import { getUpcomingOccurrences, type OccurrenceInfo } from "../../api/tasksApi";

interface Props {
  taskId: string;
  value: string;
  onChange: (iso: string) => void;
  label?: string;
  count?: number;
}

export function OccurrencePicker({ taskId, value, onChange, label = "Fälligkeit", count = 3 }: Props) {
  const [occurrences, setOccurrences] = useState<OccurrenceInfo[]>([]);
  const [showPast, setShowPast] = useState(false);
  const [didAutoSelect, setDidAutoSelect] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setOccurrences([]);
    setDidAutoSelect(false);
    setLoadError("");
    getUpcomingOccurrences(taskId, count, showPast)
      .then((data) => setOccurrences(Array.isArray(data) ? data : []))
      .catch(() => {
        setOccurrences([]);
        setLoadError("Fälligkeiten konnten nicht geladen werden");
      });
  }, [taskId, count, showPast]);

  useEffect(() => {
    if (occurrences.length > 0 && !didAutoSelect) {
      const next = occurrences.find((o) => !o.isCompleted) || occurrences[0];
      if (next && (!value || !occurrences.find((o) => o.iso === value))) {
        onChange(next.iso);
      }
      setDidAutoSelect(true);
    }
  }, [occurrences, value, onChange, didAutoSelect]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const hasValue = value && occurrences.some((o) => o.iso === value);

  return (
    <>
      <TextField
        select
        label={label}
        value={hasValue ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        fullWidth
        size="small"
      >
        {occurrences.map((o) => (
          <MenuItem key={o.iso} value={o.iso} disabled={o.isCompleted}>
            {formatDate(o.iso)}
            {o.isCompleted ? " (erledigt)" : ""}
            {o.isPlanned && !o.isCompleted ? " (geplant)" : ""}
          </MenuItem>
        ))}
        {occurrences.length === 0 && !loadError && (
          <MenuItem disabled value="">Keine Fälligkeiten gefunden</MenuItem>
        )}
      </TextField>
      <FormControlLabel
        control={<Checkbox size="small" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />}
        label={<Typography variant="caption" color="text.secondary">Vergangene Fälligkeiten anzeigen</Typography>}
      />
      {loadError && (
        <Typography variant="caption" color="error">{loadError}</Typography>
      )}
    </>
  );
}
