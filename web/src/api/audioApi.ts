import client from "./client";

export type AudioScope = "mine" | "all";

export interface AudioJob {
  id: string;
  recordingId: string;
  status: string;
  progressMs: number;
  durationMs: number;
  byteSize: number;
  mimeType: string;
  language: string;
  attempts: number;
  error: string | null;
  claimedBy: string | null;
  engine: string | null;
  /** `device` = Browser-Tab eines Nutzers, `server` = Nachtlauf. */
  processor: "server" | "device" | null;
  /** `null`, wenn der Fortschritt nicht messbar ist (Browser meldet keinen). */
  percent: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  ownerType: string;
  ownerTitle: string | null;
  ownerDate: string | null;
  path: string | null;
  userId: string;
  displayName: string;
}

export interface AudioRun {
  startedAt: string;
  triggeredBy: string;
  totalJobs: number;
  doneJobs: number;
  remainingJobs: number;
  totalMediaMs: number;
  percent: number;
  current: {
    recordingId: string;
    userId: string;
    durationMs: number;
    progressMs: number;
    percent: number;
  } | null;
  rate: number | null;
  etaCurrentMs: number | null;
  etaQueueMs: number | null;
}

export interface AudioEta {
  rate: number | null;
  rateSource: "measured" | "history" | "none";
  etaQueueMs: number | null;
  etaCurrentMs: number | null;
  mediaAheadMs: number;
  openMediaMs: number;
}

export interface AudioOverview {
  scope: AudioScope;
  server: { enabled: boolean; running: boolean; nextRunAt: string | null };
  deviceJobs: number;
  queue: { pending: number; failed: number; running: number };
  run: AudioRun | null;
  eta: AudioEta;
  jobs: { active: AudioJob[]; recent: AudioJob[]; failed: AudioJob[] };
  recentTotal: number;
  limit: number;
  offset: number;
}

export async function getAudioOverview(params: {
  scope: AudioScope;
  hours?: number;
  limit?: number;
  offset?: number;
}): Promise<AudioOverview> {
  const { data } = await client.get<AudioOverview>("/transcription/overview", {
    params: {
      scope: params.scope,
      hours: params.hours ?? 24,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    },
  });
  return data;
}

/** Setzt alle fehlgeschlagenen Jobs zurück in die Warteschlange. */
export async function requeueFailedJobs(scope: AudioScope): Promise<number> {
  const { data } = await client.post<{ requeued: number }>("/transcription/requeue", { scope });
  return data.requeued;
}
