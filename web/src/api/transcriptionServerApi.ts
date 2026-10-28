import client from "./client";

export interface ServerRunSummary {
  startedAt: string;
  finishedAt: string;
  processed: number;
  failed: number;
  stoppedBy: string | null;
  skipped: string | null;
  triggeredBy: "schedule" | "catchup" | "admin";
}

export interface ServerTranscriptionJob {
  id: string;
  recordingId: string;
  status: string;
  attempts: number;
  progressMs: number;
  error: string | null;
  updatedAt: string;
  durationMs: number;
  mimeType: string;
}

export interface ServerTranscriptionStatus {
  enabled: boolean;
  running: boolean;
  schedule: {
    at: string;
    timeZone: string;
    nextRunAt: string | null;
    catchUpUntil: string;
  };
  queue: { pending: number; running: number; failed: number };
  staleAfterMs: number;
  model: {
    present: boolean;
    bytes: number;
    totalBytes: number;
    loaded: boolean;
    files: Array<{ name: string; present: boolean; bytes: number }>;
  };
  lastRun: ServerRunSummary | null;
  runs: ServerRunSummary[];
  jobs: ServerTranscriptionJob[];
}

export async function getServerTranscriptionStatus(): Promise<ServerTranscriptionStatus> {
  const { data } = await client.get<ServerTranscriptionStatus>("/transcription/server");
  return data;
}

export async function startServerTranscription(): Promise<void> {
  await client.post("/transcription/server/run");
}
