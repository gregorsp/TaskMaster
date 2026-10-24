import { useEffect, useState } from "react";
import { Chip, CircularProgress } from "@mui/material";
import { getRunnerState, subscribeRunner, type RunnerState } from "../../asr/runner";

export function TranscriptionIndicator() {
  const [state, setState] = useState<RunnerState>(getRunnerState());

  useEffect(() => subscribeRunner(setState), []);

  if (!state.enabled || !state.running) return null;

  return (
    <Chip
      size="small"
      color="primary"
      variant="outlined"
      icon={<CircularProgress size={14} color="inherit" />}
      label="Transkription läuft"
    />
  );
}
