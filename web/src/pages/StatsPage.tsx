import { useState } from "react";
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useAuth } from "../context/AuthContext";
import { AudioStatsPanel } from "../components/stats/AudioStatsPanel";
import type { AudioScope } from "../api/audioApi";

/**
 * Kurven und Kennzahlen. Aktuell nur Audio – Aufgaben und anderes kommen als
 * weitere Sektionen dazu, die Komponenten sind bereits wiederverwendbar.
 */
export function StatsPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<AudioScope>("mine");

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
        <Typography variant="h4">Statistik</Typography>
        {user?.isAdmin && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={scope}
            onChange={(_event, value) => value !== null && setScope(value)}
          >
            <ToggleButton value="mine">Nur ich</ToggleButton>
            <ToggleButton value="all">Alle Nutzer</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Stack>

      <AudioStatsPanel scope={scope} />
    </Box>
  );
}
