import client from "./client";
import type { AudioScope } from "./audioApi";

export interface AudioDayPoint {
  date: string;
  done: number;
  failed: number;
  mediaMs: number;
  procMs: number;
}

export interface AudioStatsTotals {
  done: number;
  failed: number;
  mediaMs: number;
  procMs: number;
  medianProcMs: number | null;
  /** Audiolänge ÷ Bearbeitungszeit; 4 = viermal schneller als Echtzeit. */
  speedup: number | null;
  failureRate: number;
}

export interface AudioStatsPerUser extends AudioStatsTotals {
  userId: string;
  displayName: string;
}

export interface AudioStats {
  scope: AudioScope;
  range: { from: string; to: string; days: number };
  totals: AudioStatsTotals;
  days: AudioDayPoint[];
  perUser: AudioStatsPerUser[] | null;
}

export async function getAudioStats(scope: AudioScope, range: number): Promise<AudioStats> {
  const { data } = await client.get<AudioStats>("/stats/audio", { params: { scope, range } });
  return data;
}
