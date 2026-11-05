import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip, CircularProgress } from "@mui/material";
import { getRunnerState, subscribeRunner, type RunnerState } from "../../asr/runner";

/** Zeigt an, dass im Hintergrund transkribiert wird – und führt zur Übersicht. */
export function TranscriptionIndicator() {
  const [state, setState] = useState<RunnerState>(getRunnerState());
  const navigate = useNavigate();

  useEffect(() => subscribeRunner(setState), []);

  if (!state.enabled || !state.running) return null;

  return (
    <Chip
      size="small"
      color="primary"
      variant="outlined"
      clickable
      onClick={() => navigate("/audio")}
      icon={<CircularProgress size={14} color="inherit" />}
      label="Transkription läuft"
      title="Zur Audio-Verarbeitung"
    />
  );
}
