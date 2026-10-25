import client from "./client";

export type NoteKind = "text" | "audio";
export type TranscriptState = "none" | "pending" | "running" | "done" | "failed";

export interface NoteListItem {
  id: string;
  kind: NoteKind;
  title: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  recordingCount: number;
  durationMs: number;
  transcriptState: TranscriptState;
  progressMs: number;
}

export interface TranscriptSegment {
  id: string;
  recordingId: string;
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptionJob {
  id: string;
  recordingId: string;
  status: "pending" | "claimed" | "running" | "done" | "failed";
  progressMs: number;
  attempts: number;
  error: string | null;
}

export interface NoteRecording {
  id: string;
  ordinal: number;
  mimeType: string;
  byteSize: number;
  durationMs: number;
  language: string;
  status: "uploading" | "ready" | "failed";
  startedAt: string;
  createdAt: string;
  job: TranscriptionJob | null;
  segments: TranscriptSegment[];
}

export interface NoteDetail {
  id: string;
  kind: NoteKind;
  title: string;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  recordings: NoteRecording[];
}

export async function listNotes(params: {
  limit?: number;
  cursor?: number;
  q?: string;
  filter?: "all" | "open";
}): Promise<{ items: NoteListItem[]; nextCursor: number | null }> {
  const { data } = await client.get("/notes", { params });
  return data;
}

export async function createNote(input: {
  kind: NoteKind;
  title?: string;
  body?: string;
}): Promise<{ id: string; title: string; kind: NoteKind }> {
  const { data } = await client.post("/notes", input);
  return data;
}

export async function getNote(id: string): Promise<NoteDetail> {
  const { data } = await client.get(`/notes/${id}`);
  return data;
}

export async function updateNote(
  id: string,
  patch: { title?: string; body?: string | null }
): Promise<NoteDetail> {
  const { data } = await client.patch(`/notes/${id}`, patch);
  return data;
}

export async function deleteNote(id: string): Promise<void> {
  await client.delete(`/notes/${id}`);
}

export async function createRecordingForOwner(input: {
  ownerType: "note" | "journal_entry" | "journal_answer" | "meditation_session";
  ownerId: string;
  mimeType: string;
  startedAt?: string;
}): Promise<{ id: string; expectedSeq: number; language: string }> {
  const { data } = await client.post("/recordings", input);
  return data;
}

export async function uploadChunk(recordingId: string, seq: number, chunk: Blob): Promise<void> {
  await client.put(`/recordings/${recordingId}/chunks`, chunk, {
    params: { seq },
    headers: { "Content-Type": "application/octet-stream" },
    skipLoadingIndicator: true,
  });
}

export async function completeRecording(
  recordingId: string,
  durationMs: number,
  byteSize?: number
): Promise<void> {
  await client.post(`/recordings/${recordingId}/complete`, { durationMs, byteSize });
}

export async function putSegments(
  recordingId: string,
  segments: Array<{ startMs: number; endMs: number; text: string }>
): Promise<{ segments: TranscriptSegment[] }> {
  const { data } = await client.put(`/recordings/${recordingId}/segments`, { segments });
  return data;
}

export async function getPlaybackUrl(recordingId: string): Promise<{ url: string; expiresAt: number }> {
  const { data } = await client.post(`/recordings/${recordingId}/playback-token`);
  return data;
}

export async function fetchRecordingBlob(recordingId: string): Promise<Blob> {
  const { url } = await getPlaybackUrl(recordingId);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Audio konnte nicht geladen werden (${response.status})`);
  return response.blob();
}

export interface ClaimedJob {
  job: TranscriptionJob & { claimedBy: string | null; leaseUntil: string | null };
  recording: {
    id: string;
    ownerType: string;
    ownerId: string;
    mimeType: string;
    durationMs: number;
    language: string;
    status: string;
  };
}

export async function claimJob(deviceId: string): Promise<ClaimedJob | null> {
  const res = await client.post("/transcription/jobs/claim", { deviceId }, { validateStatus: (s) => s === 201 || s === 204 });
  return res.status === 204 ? null : res.data;
}

export async function updateJob(
  jobId: string,
  patch: { status: "running" | "failed"; progressMs?: number; error?: string }
): Promise<void> {
  await client.patch(`/transcription/jobs/${jobId}`, patch, { skipLoadingIndicator: true });
}

export async function retryJob(jobId: string): Promise<void> {
  await client.post(`/transcription/jobs/${jobId}/retry`);
}

export async function listJobs(): Promise<{
  jobs: Array<{ id: string; recordingId: string; status: string; progressMs: number; error: string | null }>;
  open: number;
}> {
  const { data } = await client.get("/transcription/jobs");
  return data;
}
