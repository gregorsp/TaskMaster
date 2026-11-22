import { Autocomplete, Box, MenuItem, Stack, TextField } from "@mui/material";
import type { TaskContext } from "../../api/contextsApi";
import type { TaskDuration, TaskEnergy, TaskStatus } from "../../api/tasksApi";
import { DURATION_LABELS, ENERGY_LABELS, STATUS_LABELS, labelEntries } from "./gtd";

export interface GtdValues {
  status: TaskStatus | null;
  duration: TaskDuration | null;
  energy: TaskEnergy | null;
  contexts: TaskContext[];
}

interface GtdFieldsProps {
  value: GtdValues;
  onChange: (patch: Partial<GtdValues>) => void;
  contextOptions: TaskContext[];
  /** Im Klär-Assistenten ergibt sich der Status aus dem gewählten Weg. */
  hideStatus?: boolean;
}

/** GTD-Einordnung einer Aufgabe: Status, Dauer, Energie und @Kontexte. */
export function GtdFields({ value, onChange, contextOptions, hideStatus = false }: GtdFieldsProps) {
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {!hideStatus && (
          <TextField
            select size="small" label="Status" sx={{ minWidth: 190 }}
            value={value.status ?? ""}
            onChange={(e) => onChange({ status: (e.target.value || null) as TaskStatus | null })}
          >
            <MenuItem value="">Kein Status</MenuItem>
            {labelEntries(STATUS_LABELS).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
          </TextField>
        )}
        <TextField
          select size="small" label="Dauer" sx={{ minWidth: 150 }}
          value={value.duration ?? ""}
          onChange={(e) => onChange({ duration: (e.target.value || null) as TaskDuration | null })}
        >
          <MenuItem value="">Keine Angabe</MenuItem>
          {labelEntries(DURATION_LABELS).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" label="Energie" sx={{ minWidth: 150 }}
          value={value.energy ?? ""}
          onChange={(e) => onChange({ energy: (e.target.value || null) as TaskEnergy | null })}
        >
          <MenuItem value="">Keine Angabe</MenuItem>
          {labelEntries(ENERGY_LABELS).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
        </TextField>
      </Stack>
      <Autocomplete
        multiple
        options={contextOptions}
        getOptionLabel={(c) => c.name}
        value={value.contexts}
        onChange={(_, v) => onChange({ contexts: v })}
        isOptionEqualToValue={(o, v) => o.id === v.id}
        renderInput={(p) => <TextField {...p} label="Kontexte" placeholder="z. B. Telefon, Computer" />}
        renderOption={(props, opt) => (
          <li {...props} key={opt.id}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: opt.color }} />
              {opt.name}
            </Box>
          </li>
        )}
      />
    </Stack>
  );
}
