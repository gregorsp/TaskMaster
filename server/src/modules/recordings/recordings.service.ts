import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import {
  journalAnswers,
  journalEntries,
  meditationSessions,
  notes,
  recordings,
  transcriptionJobs,
  transcriptSegments,
  users,
} from "../../db/schema.js";
import { MAX_AUDIO_BYTES, appendAudioChunk, audioFileSize, createAudioFile, deleteAudioFile } from "./audio.storage.js";

export type RecordingOwnerType = "note" | "journal_entry" | "journal_answer" | "meditation_session";

export const LEASE_MS = 120_000;

/**
 * Ab wann ein Job als „scheinbar noch in Arbeit" gilt und vom nächtlichen
 * Server-Lauf übernommen werden darf. Der Client verlängert seine Lease alle
 * 30 s; zehn Minuten ohne Verlängerung heißt: der Tab lebt nicht mehr.
 */
export const STALE_AFTER_MS = 10 * 60_000;

/** Aufnahmen, deren Upload nie abgeschlossen wurde, kippen nach dieser Zeit auf "failed". */
export const ABANDONED_UPLOAD_MS = 14 * 24 * 60 * 60_000;

/**
 * Der Job gehört inzwischen jemand anderem (z. B. dem nächtlichen Server-Lauf).
 * Der Client darf sein Ergebnis verwerfen, aber nichts mehr schreiben.
 */
function revokedError() {
  return Object.assign(new Error("Dieser Job wurde inzwischen anderweitig übernommen"), {
    statusCode: 409,
    code: "JOB_REVOKED",
  });
}

function assertEpoch(job: { epoch: number } | undefined, expectedEpoch?: number): void {
  if (expectedEpoch === undefined) return;
  if (!job || job.epoch !== expectedEpoch) throw revokedError();
}

const MIME_EXT: Array<[RegExp, string]> = [
  [/ogg/i, "ogg"],
  [/webm/i, "webm"],
  [/mp4|m4a|aac/i, "m4a"],
];

export function extensionForMimeType(mimeType: string): string {
  for (const [pattern, ext] of MIME_EXT) {
    if (pattern.test(mimeType)) return ext;
  }
  throw Object.assign(new Error("Nicht unterstütztes Audioformat"), {
    statusCode: 400,
    code: "UNSUPPORTED_AUDIO_TYPE",
  });
}

export interface CreateRecordingInput {
  mimeType: string;
  startedAt: Date;
}

export function getOwnedRecording(userId: string, recordingId: string) {
  return getDb()
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, recordingId), eq(recordings.userId, userId)))
    .get();
}

function ownerBelongsToUser(userId: string, ownerType: RecordingOwnerType, ownerId: string): boolean {
  const db = getDb();
  switch (ownerType) {
    case "note":
      return Boolean(
        db.select({ id: notes.id }).from(notes).where(and(eq(notes.id, ownerId), eq(notes.userId, userId))).get()
      );
    case "journal_entry":
      return Boolean(
        db
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(and(eq(journalEntries.id, ownerId), eq(journalEntries.userId, userId)))
          .get()
      );
    case "journal_answer":
      return Boolean(
        db
          .select({ id: journalAnswers.id })
          .from(journalAnswers)
          .where(and(eq(journalAnswers.id, ownerId), eq(journalAnswers.userId, userId)))
          .get()
      );
    case "meditation_session":
      return Boolean(
        db
          .select({ id: meditationSessions.id })
          .from(meditationSessions)
          .where(and(eq(meditationSessions.id, ownerId), eq(meditationSessions.userId, userId)))
          .get()
      );
    default:
      return false;
  }
}

const OWNER_TYPES: RecordingOwnerType[] = ["note", "journal_entry", "journal_answer", "meditation_session"];

export function isRecordingOwnerType(value: string): value is RecordingOwnerType {
  return (OWNER_TYPES as string[]).includes(value);
}

export function createRecording(
  userId: string,
  ownerType: RecordingOwnerType,
  ownerId: string,
  input: CreateRecordingInput
) {
  const db = getDb();

  if (!ownerBelongsToUser(userId, ownerType, ownerId)) {
    throw Object.assign(new Error("Ziel nicht gefunden"), { statusCode: 404, code: "NOT_FOUND" });
  }

  if (ownerType === "note") {
    const note = db.select().from(notes).where(eq(notes.id, ownerId)).get();
    if (note && note.kind !== "audio") {
      throw Object.assign(new Error("Nur Audio-Notizen können Aufnahmen haben"), {
        statusCode: 400,
        code: "NOTE_NOT_AUDIO",
      });
    }
  }

  const existing = db
    .select()
    .from(recordings)
    .where(and(eq(recordings.ownerType, ownerType), eq(recordings.ownerId, ownerId)))
    .all();

  const language =
    db
      .select({ language: users.transcriptionLanguage })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.language ?? "de";

  const id = uuid();
  const filename = `${id}.${extensionForMimeType(input.mimeType)}`;
  const now = new Date();

  createAudioFile(filename);

  db.insert(recordings)
    .values({
      id,
      userId,
      ownerType,
      ownerId,
      ordinal: existing.length,
      filename,
      mimeType: input.mimeType,
      byteSize: 0,
      chunkCount: 0,
      durationMs: 0,
      language,
      status: "uploading",
      startedAt: input.startedAt,
      createdAt: now,
    })
    .run();

  db.insert(transcriptionJobs)
    .values({
      id: uuid(),
      recordingId: id,
      userId,
      status: "pending",
      progressMs: 0,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { id, ordinal: existing.length, expectedSeq: 0, language };
}

export function deleteRecordingsForOwner(userId: string, ownerType: RecordingOwnerType, ownerId: string): void {
  const db = getDb();
  const owned = db
    .select()
    .from(recordings)
    .where(and(eq(recordings.ownerType, ownerType), eq(recordings.ownerId, ownerId)))
    .all()
    .filter((recording) => recording.userId === userId);

  for (const recording of owned) {
    deleteAudioFile(recording.filename);
  }

  const ids = owned.map((recording) => recording.id);
  if (ids.length === 0) return;

  db.delete(transcriptSegments).where(inArray(transcriptSegments.recordingId, ids)).run();
  db.delete(transcriptionJobs).where(inArray(transcriptionJobs.recordingId, ids)).run();
  db.delete(recordings).where(inArray(recordings.id, ids)).run();
}

export function listRecordingsForOwners(ownerType: RecordingOwnerType, ownerIds: string[]) {
  if (ownerIds.length === 0) return [];
  const db = getDb();
  const owned = db
    .select()
    .from(recordings)
    .where(and(eq(recordings.ownerType, ownerType), inArray(recordings.ownerId, ownerIds)))
    .all()
    .sort((a, b) => a.ordinal - b.ordinal);

  const ids = owned.map((recording) => recording.id);
  const segments = ids.length
    ? db.select().from(transcriptSegments).where(inArray(transcriptSegments.recordingId, ids)).all()
    : [];

  return owned.map((recording) => ({
    id: recording.id,
    ownerId: recording.ownerId,
    ordinal: recording.ordinal,
    mimeType: recording.mimeType,
    byteSize: recording.byteSize,
    durationMs: recording.durationMs,
    language: recording.language,
    status: recording.status,
    startedAt: recording.startedAt,
    segments: segments
      .filter((segment) => segment.recordingId === recording.id)
      .sort((a, b) => a.idx - b.idx),
  }));
}

export type ChunkResult =
  | { status: "accepted"; chunkCount: number; byteSize: number }
  | { status: "duplicate"; chunkCount: number; byteSize: number }
  | { status: "gap"; expectedSeq: number };

export function appendChunk(
  userId: string,
  recordingId: string,
  seq: number,
  chunk: Buffer
): ChunkResult {
  const db = getDb();
  const recording = getOwnedRecording(userId, recordingId);
  if (!recording) {
    throw Object.assign(new Error("Aufnahme nicht gefunden"), { statusCode: 404, code: "NOT_FOUND" });
  }
  if (recording.status !== "uploading") {
    throw Object.assign(new Error("Aufnahme ist bereits abgeschlossen"), {
      statusCode: 409,
      code: "RECORDING_COMPLETE",
    });
  }

  if (seq < recording.chunkCount) {
    return { status: "duplicate", chunkCount: recording.chunkCount, byteSize: recording.byteSize };
  }
  if (seq > recording.chunkCount) {
    return { status: "gap", expectedSeq: recording.chunkCount };
  }
  if (recording.byteSize + chunk.length > MAX_AUDIO_BYTES) {
    throw Object.assign(new Error("Aufnahme überschreitet die Größenbegrenzung"), {
      statusCode: 413,
      code: "AUDIO_TOO_LARGE",
    });
  }

  const byteSize = appendAudioChunk(recording.filename, chunk);
  const chunkCount = recording.chunkCount + 1;
  db.update(recordings)
    .set({ byteSize, chunkCount })
    .where(eq(recordings.id, recordingId))
    .run();

  return { status: "accepted", chunkCount, byteSize };
}

export function completeRecording(
  userId: string,
  recordingId: string,
  durationMs: number,
  expectedByteSize?: number
) {
  const db = getDb();
  const recording = getOwnedRecording(userId, recordingId);
  if (!recording) {
    throw Object.assign(new Error("Aufnahme nicht gefunden"), { statusCode: 404, code: "NOT_FOUND" });
  }
  if (recording.chunkCount === 0) {
    throw Object.assign(new Error("Aufnahme enthält keine Daten"), {
      statusCode: 409,
      code: "NO_AUDIO",
    });
  }

  const byteSize = audioFileSize(recording.filename);
  if (expectedByteSize !== undefined && expectedByteSize !== byteSize) {
    // Der Client hat mehr Bytes übertragen als angekommen sind — die Aufnahme
    // darf nicht als fertig markiert werden, sonst fehlt der letzte Abschnitt.
    throw Object.assign(new Error("Aufnahme ist noch nicht vollständig übertragen"), {
      statusCode: 409,
      code: "UPLOAD_INCOMPLETE",
    });
  }

  db.update(recordings)
    .set({ status: "ready", durationMs, byteSize })
    .where(eq(recordings.id, recordingId))
    .run();

  return { id: recordingId, durationMs, byteSize };
}

export interface SegmentInput {
  startMs: number;
  endMs: number;
  text: string;
}

export function replaceSegments(
  userId: string,
  recordingId: string,
  segments: SegmentInput[],
  expectedEpoch?: number
) {
  const recording = getOwnedRecording(userId, recordingId);
  if (!recording) {
    throw Object.assign(new Error("Aufnahme nicht gefunden"), { statusCode: 404, code: "NOT_FOUND" });
  }
  return writeSegments(recording, segments, expectedEpoch);
}

/**
 * Wie `replaceSegments`, aber ohne Eigentümerprüfung – für den Server-Lauf, der
 * die Jobs aller Nutzer abarbeitet. Die Revision schützt trotzdem davor, dass
 * ein parallel laufender Tab das Ergebnis überschreibt.
 */
export function replaceSegmentsInternal(
  recordingId: string,
  segments: SegmentInput[],
  expectedEpoch?: number
) {
  const recording = getDb().select().from(recordings).where(eq(recordings.id, recordingId)).get();
  if (!recording) {
    throw Object.assign(new Error("Aufnahme nicht gefunden"), { statusCode: 404, code: "NOT_FOUND" });
  }
  return writeSegments(recording, segments, expectedEpoch);
}

function writeSegments(
  recording: typeof recordings.$inferSelect,
  segments: SegmentInput[],
  expectedEpoch?: number
) {
  const db = getDb();
  const job = db.select().from(transcriptionJobs).where(eq(transcriptionJobs.recordingId, recording.id)).get();
  assertEpoch(job, expectedEpoch);

  db.delete(transcriptSegments).where(eq(transcriptSegments.recordingId, recording.id)).run();

  if (segments.length > 0) {
    db.insert(transcriptSegments)
      .values(
        segments.map((segment, index) => ({
          id: uuid(),
          recordingId: recording.id,
          idx: index,
          startMs: segment.startMs,
          endMs: segment.endMs,
          text: segment.text.trim(),
        }))
      )
      .run();
  }

  const now = new Date();
  db.update(transcriptionJobs)
    .set({
      status: "done",
      progressMs: recording.durationMs,
      claimedBy: null,
      leaseUntil: null,
      error: null,
      updatedAt: now,
    })
    .where(eq(transcriptionJobs.recordingId, recording.id))
    .run();

  return db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.recordingId, recording.id))
    .all()
    .sort((a, b) => a.idx - b.idx);
}

export function claimJob(userId: string, deviceId: string) {
  const db = getDb();
  const now = new Date();

  // Ein abgestürzter Tab hinterlässt Jobs auf "claimed" *oder* "running" —
  // der Worker setzt den Status sofort auf "running". Beide müssen nach
  // Ablauf der Lease wieder claimbar werden.
  const expired = db
    .select({ id: transcriptionJobs.id })
    .from(transcriptionJobs)
    .where(
      and(
        eq(transcriptionJobs.userId, userId),
        inArray(transcriptionJobs.status, ["claimed", "running"]),
        lt(transcriptionJobs.leaseUntil, now)
      )
    )
    .all();

  for (const job of expired) {
    db.update(transcriptionJobs)
      .set({ status: "pending", claimedBy: null, leaseUntil: null, updatedAt: now })
      .where(eq(transcriptionJobs.id, job.id))
      .run();
  }

  // Fehlgeschlagene Jobs werden bis zu dreimal erneut versucht; danach bleiben
  // sie sichtbar fehlgeschlagen und können manuell wiederholt werden.
  const retryable = db
    .select({ id: transcriptionJobs.id })
    .from(transcriptionJobs)
    .where(
      and(
        eq(transcriptionJobs.userId, userId),
        eq(transcriptionJobs.status, "failed"),
        lt(transcriptionJobs.attempts, 3)
      )
    )
    .all();

  for (const job of retryable) {
    db.update(transcriptionJobs)
      .set({ status: "pending", claimedBy: null, leaseUntil: null, updatedAt: now })
      .where(eq(transcriptionJobs.id, job.id))
      .run();
  }

  const pending = db
    .select()
    .from(transcriptionJobs)
    .where(and(eq(transcriptionJobs.userId, userId), eq(transcriptionJobs.status, "pending")))
    .orderBy(transcriptionJobs.createdAt)
    .limit(1)
    .get();

  if (!pending) return null;

  const recording = db.select().from(recordings).where(eq(recordings.id, pending.recordingId)).get();
  if (!recording) {
    db.delete(transcriptionJobs).where(eq(transcriptionJobs.id, pending.id)).run();
    return null;
  }

  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  db.update(transcriptionJobs)
    .set({
      status: "claimed",
      claimedBy: deviceId,
      leaseUntil,
      attempts: pending.attempts + 1,
      updatedAt: now,
    })
    .where(eq(transcriptionJobs.id, pending.id))
    .run();

  return {
    job: { ...pending, status: "claimed", claimedBy: deviceId, leaseUntil, attempts: pending.attempts + 1 },
    recording,
  };
}

export function updateJob(
  userId: string,
  jobId: string,
  patch: { status: "running" | "failed"; progressMs?: number; error?: string },
  expectedEpoch?: number
) {
  const db = getDb();
  const job = db
    .select()
    .from(transcriptionJobs)
    .where(and(eq(transcriptionJobs.id, jobId), eq(transcriptionJobs.userId, userId)))
    .get();
  if (!job) return null;
  assertEpoch(job, expectedEpoch);

  const now = new Date();
  if (patch.status === "running") {
    db.update(transcriptionJobs)
      .set({
        status: "running",
        progressMs: patch.progressMs ?? job.progressMs,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        updatedAt: now,
      })
      .where(eq(transcriptionJobs.id, jobId))
      .run();
  } else {
    db.update(transcriptionJobs)
      .set({
        status: "failed",
        error: patch.error ?? "Unbekannter Fehler",
        leaseUntil: null,
        updatedAt: now,
      })
      .where(eq(transcriptionJobs.id, jobId))
      .run();
  }

  return db.select().from(transcriptionJobs).where(eq(transcriptionJobs.id, jobId)).get();
}

export function resetJob(userId: string, jobId: string) {
  const db = getDb();
  const job = db
    .select()
    .from(transcriptionJobs)
    .where(and(eq(transcriptionJobs.id, jobId), eq(transcriptionJobs.userId, userId)))
    .get();
  if (!job) return null;

  const now = new Date();
  db.update(transcriptionJobs)
    .set({
      status: "pending",
      attempts: 0,
      error: null,
      claimedBy: null,
      leaseUntil: null,
      progressMs: 0,
      // Revision hochzählen: ein noch laufender Tab verliert damit das
      // Schreibrecht, statt das neue Ergebnis zu überschreiben.
      epoch: job.epoch + 1,
      updatedAt: now,
    })
    .where(eq(transcriptionJobs.id, jobId))
    .run();

  return db.select().from(transcriptionJobs).where(eq(transcriptionJobs.id, jobId)).get();
}

export function listJobs(userId: string) {
  const db = getDb();
  return db
    .select({
      id: transcriptionJobs.id,
      recordingId: transcriptionJobs.recordingId,
      status: transcriptionJobs.status,
      progressMs: transcriptionJobs.progressMs,
      attempts: transcriptionJobs.attempts,
      error: transcriptionJobs.error,
      createdAt: transcriptionJobs.createdAt,
      durationMs: recordings.durationMs,
      ownerId: recordings.ownerId,
    })
    .from(transcriptionJobs)
    .leftJoin(recordings, eq(recordings.id, transcriptionJobs.recordingId))
    .where(
      and(
        eq(transcriptionJobs.userId, userId),
        inArray(transcriptionJobs.status, ["pending", "claimed", "running", "failed"])
      )
    )
    .all()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function countOpenJobs(userId: string) {
  return getDb()
    .select({ count: sql<number>`count(*)` })
    .from(transcriptionJobs)
    .where(
      and(
        eq(transcriptionJobs.userId, userId),
        inArray(transcriptionJobs.status, ["pending", "claimed", "running"])
      )
    )
    .get()?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Serverseitige Transkription (nächtlicher Lauf)
// ---------------------------------------------------------------------------

export type JobRow = typeof transcriptionJobs.$inferSelect;
export type RecordingRow = typeof recordings.$inferSelect;

export interface QueueEntry {
  job: JobRow;
  recording: RecordingRow;
}

/**
 * Übernimmt einen Job für den Server-Lauf: Revision hochzählen, Lease setzen,
 * Fortschritt zurücksetzen. Ein Client, der noch an dem Job arbeitet, bekommt
 * danach 409 JOB_REVOKED und verwirft sein Ergebnis.
 */
export function takeOverJob(jobId: string, claimedBy = "server"): QueueEntry | null {
  const db = getDb();
  const job = db.select().from(transcriptionJobs).where(eq(transcriptionJobs.id, jobId)).get();
  if (!job) return null;

  const now = new Date();
  const epoch = job.epoch + 1;
  const attempts = job.attempts + 1;
  const leaseUntil = new Date(now.getTime() + LEASE_MS);

  db.update(transcriptionJobs)
    .set({
      status: "claimed",
      epoch,
      claimedBy,
      leaseUntil,
      progressMs: 0,
      error: null,
      attempts,
      updatedAt: now,
    })
    .where(eq(transcriptionJobs.id, jobId))
    .run();

  const recording = db.select().from(recordings).where(eq(recordings.id, job.recordingId)).get();
  if (!recording) return null;

  return {
    job: { ...job, status: "claimed", epoch, claimedBy, leaseUntil, progressMs: 0, error: null, attempts },
    recording,
  };
}

export function touchJobProgress(jobId: string, progressMs: number, expectedEpoch?: number): void {
  const db = getDb();
  const job = db.select().from(transcriptionJobs).where(eq(transcriptionJobs.id, jobId)).get();
  if (!job) return;
  assertEpoch(job, expectedEpoch);

  const now = new Date();
  db.update(transcriptionJobs)
    .set({
      status: "running",
      progressMs,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      updatedAt: now,
    })
    .where(eq(transcriptionJobs.id, jobId))
    .run();
}

export function markJobFailed(jobId: string, error: string, expectedEpoch?: number): void {
  const db = getDb();
  const job = db.select().from(transcriptionJobs).where(eq(transcriptionJobs.id, jobId)).get();
  if (!job) return;
  assertEpoch(job, expectedEpoch);

  const now = new Date();
  db.update(transcriptionJobs)
    .set({
      status: "failed",
      error: error.slice(0, 1000),
      leaseUntil: null,
      claimedBy: null,
      updatedAt: now,
    })
    .where(eq(transcriptionJobs.id, jobId))
    .run();
}

/** Gibt einen Job ohne Ergebnis zurück in die Warteschlange (z. B. bei SIGTERM). */
export function releaseJob(jobId: string): void {
  const now = new Date();
  getDb()
    .update(transcriptionJobs)
    .set({ status: "pending", claimedBy: null, leaseUntil: null, progressMs: 0, updatedAt: now })
    .where(eq(transcriptionJobs.id, jobId))
    .run();
}

/**
 * Räumt Jobs auf, deren Client abgestürzt ist, und markiert Aufnahmen, deren
 * Upload nie abgeschlossen wurde. Ohne diesen Sweep zeigt die UI einen Job
 * dauerhaft als "läuft", weil `claimJob` abgelaufene Leases nur beim nächsten
 * Claim zurücksetzt.
 */
export function sweepStaleJobs(now = new Date()): { released: number; abandonedUploads: number } {
  const db = getDb();

  const stale = db
    .select({ id: transcriptionJobs.id })
    .from(transcriptionJobs)
    .where(
      and(inArray(transcriptionJobs.status, ["claimed", "running"]), lt(transcriptionJobs.leaseUntil, now))
    )
    .all();

  for (const job of stale) {
    db.update(transcriptionJobs)
      .set({ status: "pending", claimedBy: null, leaseUntil: null, updatedAt: now })
      .where(eq(transcriptionJobs.id, job.id))
      .run();
  }

  const abandonedCutoff = new Date(now.getTime() - ABANDONED_UPLOAD_MS);
  const abandoned = db
    .select({ id: recordings.id })
    .from(recordings)
    .where(and(eq(recordings.status, "uploading"), lt(recordings.createdAt, abandonedCutoff)))
    .all();

  for (const recording of abandoned) {
    db.update(recordings).set({ status: "failed" }).where(eq(recordings.id, recording.id)).run();
  }

  return { released: stale.length, abandonedUploads: abandoned.length };
}

/**
 * Jobs, die der nächtliche Lauf abarbeiten darf: alles Offene, alles, was seit
 * über zehn Minuten keinen Heartbeat mehr hatte, und alles Fehlgeschlagene.
 * Nur Aufnahmen, deren Upload abgeschlossen ist – halbe Dateien kann der
 * Decoder nicht sinnvoll lesen.
 */
export function listServerQueue(now = new Date()): QueueEntry[] {
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);

  return getDb()
    .select({ job: transcriptionJobs, recording: recordings })
    .from(transcriptionJobs)
    .innerJoin(recordings, eq(recordings.id, transcriptionJobs.recordingId))
    .where(
      and(
        eq(recordings.status, "ready"),
        or(
          eq(transcriptionJobs.status, "pending"),
          eq(transcriptionJobs.status, "failed"),
          and(
            inArray(transcriptionJobs.status, ["claimed", "running"]),
            lt(transcriptionJobs.updatedAt, staleBefore)
          )
        )
      )
    )
    .orderBy(transcriptionJobs.createdAt)
    .all();
}

export function getJobById(jobId: string): JobRow | undefined {
  return getDb().select().from(transcriptionJobs).where(eq(transcriptionJobs.id, jobId)).get();
}

export function getRecordingById(recordingId: string): RecordingRow | undefined {
  return getDb().select().from(recordings).where(eq(recordings.id, recordingId)).get();
}
