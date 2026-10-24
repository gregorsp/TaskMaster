import { and, desc, eq, inArray } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { meditationComments, meditationSessions } from "../../db/schema.js";
import {
  deleteRecordingsForOwner,
  listRecordingsForOwners,
} from "../recordings/recordings.service.js";

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface SessionInput {
  startedAt: Date;
  plannedDurationSec?: number | null;
  actualDurationSec?: number;
  note?: string | null;
  concentration?: number | null;
}

export function createSession(userId: string, input: SessionInput) {
  const db = getDb();
  const now = new Date();
  const row = {
    id: uuid(),
    userId,
    startedAt: input.startedAt,
    endedAt: null as Date | null,
    plannedDurationSec: input.plannedDurationSec ?? null,
    actualDurationSec: input.actualDurationSec ?? 0,
    note: input.note ?? null,
    concentration: input.concentration ?? null,
    createdAt: now,
  };
  db.insert(meditationSessions).values(row).run();
  return row;
}

export function findSession(userId: string, sessionId: string) {
  return getDb()
    .select()
    .from(meditationSessions)
    .where(and(eq(meditationSessions.id, sessionId), eq(meditationSessions.userId, userId)))
    .get();
}

export function updateSession(
  userId: string,
  sessionId: string,
  patch: {
    endedAt?: Date | null;
    plannedDurationSec?: number | null;
    actualDurationSec?: number;
    note?: string | null;
    concentration?: number | null;
  }
) {
  const db = getDb();
  const existing = findSession(userId, sessionId);
  if (!existing) return null;

  const updates: Record<string, unknown> = {};
  if (patch.endedAt !== undefined) updates.endedAt = patch.endedAt;
  if (patch.plannedDurationSec !== undefined) updates.plannedDurationSec = patch.plannedDurationSec;
  if (patch.actualDurationSec !== undefined) updates.actualDurationSec = patch.actualDurationSec;
  if (patch.note !== undefined) updates.note = patch.note;
  if (patch.concentration !== undefined) updates.concentration = patch.concentration;

  if (Object.keys(updates).length > 0) {
    db.update(meditationSessions).set(updates).where(eq(meditationSessions.id, sessionId)).run();
  }
  return findSession(userId, sessionId);
}

export function deleteSession(userId: string, sessionId: string): boolean {
  const db = getDb();
  const existing = findSession(userId, sessionId);
  if (!existing) return false;
  deleteRecordingsForOwner(userId, "meditation_session", sessionId);
  db.delete(meditationComments).where(eq(meditationComments.sessionId, sessionId)).run();
  db.delete(meditationSessions).where(eq(meditationSessions.id, sessionId)).run();
  return true;
}

export function addComment(userId: string, sessionId: string, text: string) {
  const db = getDb();
  const session = findSession(userId, sessionId);
  if (!session) return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  const row = {
    id: uuid(),
    userId,
    sessionId,
    text: trimmed,
    createdAt: new Date(),
  };
  db.insert(meditationComments).values(row).run();
  return row;
}

export function deleteComment(userId: string, sessionId: string, commentId: string): boolean {
  const db = getDb();
  const existing = db
    .select()
    .from(meditationComments)
    .where(
      and(
        eq(meditationComments.id, commentId),
        eq(meditationComments.sessionId, sessionId),
        eq(meditationComments.userId, userId)
      )
    )
    .get();
  if (!existing) return false;
  db.delete(meditationComments).where(eq(meditationComments.id, commentId)).run();
  return true;
}

export function listSessions(userId: string, limit = 50) {
  const db = getDb();
  const sessions = db
    .select()
    .from(meditationSessions)
    .where(eq(meditationSessions.userId, userId))
    .orderBy(desc(meditationSessions.startedAt))
    .limit(limit)
    .all();

  const ids = sessions.map((session) => session.id);
  const recordings = listRecordingsForOwners("meditation_session", ids);
  const comments = ids.length
    ? db.select().from(meditationComments).where(inArray(meditationComments.sessionId, ids)).all()
    : [];

  return sessions.map((session) => ({
    ...session,
    recordings: recordings.filter((recording) => recording.ownerId === session.id),
    comments: comments
      .filter((comment) => comment.sessionId === session.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  }));
}

export function getStats(userId: string) {
  const db = getDb();
  const sessions = db
    .select()
    .from(meditationSessions)
    .where(eq(meditationSessions.userId, userId))
    .all();

  const now = Date.now();
  const sumSeconds = (list: typeof sessions) =>
    list.reduce((total, session) => total + (session.actualDurationSec ?? 0), 0);

  const week = sessions.filter((session) => now - session.startedAt.getTime() < 7 * 86_400_000);
  const month = sessions.filter((session) => now - session.startedAt.getTime() < 30 * 86_400_000);
  const rated = month.filter((session) => session.concentration !== null);
  const avgConcentration =
    rated.length > 0
      ? Math.round((rated.reduce((total, session) => total + (session.concentration ?? 0), 0) / rated.length) * 10) / 10
      : null;

  const days = new Set(sessions.map((session) => isoDate(session.startedAt)));
  const today = new Date();
  let streak = 0;
  let offset = days.has(isoDate(today)) ? 0 : 1;
  for (; offset < 3650; offset++) {
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - offset);
    if (!days.has(isoDate(cursor))) break;
    streak += 1;
  }

  return {
    totalSessions: sessions.length,
    totalMinutes: Math.round(sumSeconds(sessions) / 60),
    weekMinutes: Math.round(sumSeconds(week) / 60),
    monthMinutes: Math.round(sumSeconds(month) / 60),
    streak,
    avgConcentration,
    ratedSessions: rated.length,
  };
}
