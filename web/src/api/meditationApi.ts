import client from "./client";
import type { NoteRecording } from "./notesApi";

export interface MeditationComment {
  id: string;
  userId: string;
  sessionId: string;
  text: string;
  createdAt: string;
}

export interface MeditationSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  plannedDurationSec: number | null;
  actualDurationSec: number;
  note: string | null;
  concentration: number | null;
  createdAt: string;
  recordings: NoteRecording[];
  comments: MeditationComment[];
}

export interface MeditationStats {
  totalSessions: number;
  totalMinutes: number;
  weekMinutes: number;
  monthMinutes: number;
  streak: number;
  avgConcentration: number | null;
  ratedSessions: number;
}

export async function listSessions(
  limit = 50
): Promise<{ sessions: MeditationSession[]; stats: MeditationStats }> {
  const { data } = await client.get("/meditation/sessions", { params: { limit } });
  return data;
}

export async function createSession(input: {
  startedAt?: string;
  plannedDurationSec?: number | null;
  actualDurationSec?: number;
  note?: string | null;
  concentration?: number | null;
}): Promise<MeditationSession> {
  const { data } = await client.post("/meditation/sessions", input);
  return data;
}

export async function updateSession(
  id: string,
  patch: {
    endedAt?: string | null;
    plannedDurationSec?: number | null;
    actualDurationSec?: number;
    note?: string | null;
    concentration?: number | null;
  }
): Promise<MeditationSession> {
  const { data } = await client.patch(`/meditation/sessions/${id}`, patch);
  return data;
}

export async function deleteSession(id: string): Promise<void> {
  await client.delete(`/meditation/sessions/${id}`);
}

export async function addComment(sessionId: string, text: string): Promise<MeditationComment> {
  const { data } = await client.post(`/meditation/sessions/${sessionId}/comments`, { text });
  return data;
}

export async function deleteComment(sessionId: string, commentId: string): Promise<void> {
  await client.delete(`/meditation/sessions/${sessionId}/comments/${commentId}`);
}

export async function getStats(): Promise<MeditationStats> {
  const { data } = await client.get("/meditation/stats");
  return data;
}
