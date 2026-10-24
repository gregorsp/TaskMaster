import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { notes, recordings, transcriptionJobs, transcriptSegments } from "../../db/schema.js";
import { deleteAudioFile } from "../recordings/audio.storage.js";

export type NoteKind = "text" | "audio";
export type TranscriptState = "none" | "pending" | "running" | "done" | "failed";

export interface NoteInput {
  kind: NoteKind;
  title?: string;
  body?: string;
}

export interface NotePatch {
  title?: string;
  body?: string | null;
}

export interface ListNotesOptions {
  limit: number;
  cursor?: number;
  q?: string;
  filter: "all" | "open";
}

function deriveTitle(body: string): string {
  const firstLine = body.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return "Notiz";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

function transcriptState(statuses: string[]): TranscriptState {
  if (statuses.length === 0) return "none";
  if (statuses.some((s) => s === "running" || s === "claimed")) return "running";
  if (statuses.some((s) => s === "pending")) return "pending";
  if (statuses.every((s) => s === "done")) return "done";
  if (statuses.some((s) => s === "failed")) return "failed";
  return "pending";
}

export function findNote(userId: string, noteId: string) {
  return getDb()
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .get();
}

export function createNote(userId: string, input: NoteInput) {
  const db = getDb();
  const now = new Date();
  const title =
    input.title?.trim() ||
    (input.kind === "text" ? deriveTitle(input.body ?? "") : "Neue Aufnahme");

  const row = {
    id: uuid(),
    userId,
    kind: input.kind,
    title,
    body: input.kind === "text" ? input.body ?? null : null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(notes).values(row).run();
  return row;
}

export function updateNote(userId: string, noteId: string, patch: NotePatch) {
  const db = getDb();
  const existing = findNote(userId, noteId);
  if (!existing) return null;

  if (existing.kind === "audio" && patch.body !== undefined) {
    throw Object.assign(new Error("Aufnahmen haben keinen zusätzlichen Text"), {
      statusCode: 400,
      code: "BODY_NOT_EDITABLE",
    });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.body !== undefined) updates.body = patch.body;

  db.update(notes).set(updates).where(eq(notes.id, noteId)).run();
  return findNote(userId, noteId);
}

export function deleteNote(userId: string, noteId: string): boolean {
  const db = getDb();
  const note = findNote(userId, noteId);
  if (!note) return false;

  const owned = db
    .select()
    .from(recordings)
    .where(and(eq(recordings.ownerType, "note"), eq(recordings.ownerId, noteId)))
    .all()
    .filter((recording) => recording.userId === userId);

  for (const recording of owned) {
    deleteAudioFile(recording.filename);
  }

  const recordingIds = owned.map((recording) => recording.id);
  if (recordingIds.length > 0) {
    db.delete(transcriptSegments).where(inArray(transcriptSegments.recordingId, recordingIds)).run();
    db.delete(transcriptionJobs).where(inArray(transcriptionJobs.recordingId, recordingIds)).run();
    db.delete(recordings).where(inArray(recordings.id, recordingIds)).run();
  }

  db.delete(notes).where(eq(notes.id, noteId)).run();
  return true;
}

export function listNotes(userId: string, options: ListNotesOptions) {
  const db = getDb();
  const limit = options.limit;
  const conditions = [eq(notes.userId, userId)];

  if (options.cursor !== undefined) {
    conditions.push(lt(notes.createdAt, new Date(options.cursor)));
  }

  if (options.q) {
    const term = options.q.replace(/[%_\\]/g, " ").trim();
    const pattern = `%${term}%`;
    conditions.push(
      sql`(${notes.title} LIKE ${pattern} OR ${notes.body} LIKE ${pattern} OR EXISTS (
        SELECT 1 FROM transcript_segments s
        JOIN recordings r ON r.id = s.recording_id
        WHERE r.owner_type = 'note' AND r.owner_id = ${notes.id} AND s.text LIKE ${pattern}
      ))`
    );
  }

  if (options.filter === "open") {
    conditions.push(
      sql`(${notes.kind} = 'audio' AND NOT EXISTS (
        SELECT 1 FROM transcript_segments s
        JOIN recordings r ON r.id = s.recording_id
        WHERE r.owner_type = 'note' AND r.owner_id = ${notes.id}
      ))`
    );
  }

  const rows = db
    .select()
    .from(notes)
    .where(and(...conditions))
    .orderBy(desc(notes.createdAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const noteIds = page.map((row) => row.id);

  const pageRecordings = noteIds.length
    ? db
        .select()
        .from(recordings)
        .where(and(eq(recordings.ownerType, "note"), inArray(recordings.ownerId, noteIds)))
        .all()
    : [];

  const recordingIds = pageRecordings.map((recording) => recording.id);
  const jobs = recordingIds.length
    ? db.select().from(transcriptionJobs).where(inArray(transcriptionJobs.recordingId, recordingIds)).all()
    : [];

  const items = page.map((note) => {
    const own = pageRecordings.filter((recording) => recording.ownerId === note.id);
    const ownJobs = own
      .map((recording) => jobs.find((job) => job.recordingId === recording.id))
      .filter((job): job is (typeof jobs)[number] => Boolean(job));

    return {
      id: note.id,
      kind: note.kind,
      title: note.title,
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      recordingCount: own.length,
      durationMs: own.reduce((sum, recording) => sum + recording.durationMs, 0),
      transcriptState: transcriptState(ownJobs.map((job) => job.status)),
      progressMs: ownJobs.reduce((max, job) => Math.max(max, job.progressMs), 0),
    };
  });

  const last = page[page.length - 1];
  return { items, nextCursor: hasMore && last ? last.createdAt.getTime() : null };
}

export function getNoteDetail(userId: string, noteId: string) {
  const db = getDb();
  const note = findNote(userId, noteId);
  if (!note) return null;

  const owned = db
    .select()
    .from(recordings)
    .where(and(eq(recordings.ownerType, "note"), eq(recordings.ownerId, noteId)))
    .all()
    .filter((recording) => recording.userId === userId)
    .sort((a, b) => a.ordinal - b.ordinal);

  const recordingIds = owned.map((recording) => recording.id);
  const segments = recordingIds.length
    ? db.select().from(transcriptSegments).where(inArray(transcriptSegments.recordingId, recordingIds)).all()
    : [];
  const jobs = recordingIds.length
    ? db.select().from(transcriptionJobs).where(inArray(transcriptionJobs.recordingId, recordingIds)).all()
    : [];

  return {
    ...note,
    recordings: owned.map((recording) => ({
      id: recording.id,
      ordinal: recording.ordinal,
      mimeType: recording.mimeType,
      byteSize: recording.byteSize,
      durationMs: recording.durationMs,
      language: recording.language,
      status: recording.status,
      startedAt: recording.startedAt,
      createdAt: recording.createdAt,
      job: jobs.find((job) => job.recordingId === recording.id) ?? null,
      segments: segments
        .filter((segment) => segment.recordingId === recording.id)
        .sort((a, b) => a.idx - b.idx),
    })),
  };
}
