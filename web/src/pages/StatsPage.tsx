import { useState } from "react";
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useAuth } from "../context/AuthContext";
import { AudioStatsPanel } from "../components/stats/AudioStatsPanel";
import { MeditationStatsPanel } from "../components/stats/MeditationStatsPanel";
import { RangeSelector } from "../components/stats/RangeSelector";
import { TaskStatsPanel } from "../components/stats/TaskStatsPanel";
import type { StatsRangeSelection, StatsScope } from "../api/statsApi";

/**
 * Statistik-Seite mit drei Sektionen. Die Zeitraumwahl gilt für alle
 * Sektionen; jede lädt und fehlert unabhängig.
 */
export function StatsPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<StatsScope>("mine");
  const [range, setRange] = useState<StatsRangeSelection>({ preset: "30d" });

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
        <Typography variant="h4">Statistik</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap" useFlexGap alignItems="center">
          <RangeSelector value={range} onChange={setRange} />
          {user?.isAdmin && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={scope}
              onChange={(_event, value: StatsScope | null) => value !== null && setScope(value)}
            >
              <ToggleButton value="mine">Nur ich</ToggleButton>
              <ToggleButton value="all">Alle Nutzer</ToggleButton>
            </ToggleButtonGroup>
          )}
        </Stack>
      </Stack>

      <Stack spacing={3}>
        <TaskStatsPanel scope={scope} range={range} />
        <MeditationStatsPanel scope={scope} range={range} />
        <AudioStatsPanel scope={scope} range={range} />
      </Stack>
    </Box>
  );
}
