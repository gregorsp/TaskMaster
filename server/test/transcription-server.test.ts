import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { scrypt, randomBytes } from "node:crypto";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { closeDb, getDb, getRawDb, initDb } from "../src/db/client.js";
import { runMigration } from "../src/db/migrations.js";
import { notes, users } from "../src/db/schema.js";
import {
  appendChunk,
  claimJob,
  completeRecording,
  createRecording,
  getJobById,
  listServerQueue,
  sweepStaleJobs,
  takeOverJob,
} from "../src/modules/recordings/recordings.service.js";
import { runTranscriptionBatch } from "../src/modules/transcription/server/runner.js";
import { buildSegments, splitSentences } from "../src/modules/transcription/server/segments.js";
import {
  nextRunAt,
  shouldCatchUp,
  zonedDateKey,
  zonedTimeToInstant,
} from "../src/modules/transcription/server/schedule.js";
import type { TranscriptionEngine } from "../src/modules/transcription/server/engine.js";
import { readLastRun } from "../src/modules/transcription/server/runlog.js";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => (err ? reject(err) : resolve(salt + ":" + k.toString("hex"))));
  });
}

let app: FastifyInstance;
let adminId: string;
let ownerId: string;
let adminToken: string;
let ownerToken: string;

async function seedUser(username: string, isAdmin: boolean): Promise<string> {
  const id = uuid();
  const salt = randomBytes(16).toString("hex");
  getDb()
    .insert(users)
    .values({
      id,
      username,
      email: `${username}@test.com`,
      passwordHash: await hashPassword("transkript123", salt),
      displayName: username,
      isAdmin,
      createdAt: new Date(),
    })
    .run();
  return id;
}

async function login(email: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: "transkript123" },
  });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}

function headers(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Legt Audio-Notiz + Aufnahme + Job an und schließt den Upload ab. */
function seedAudioJob(userId: string, options?: { durationMs?: number; ready?: boolean }): string {
  const noteId = uuid();
  const now = new Date();
  getDb()
    .insert(notes)
    .values({ id: noteId, userId, kind: "audio", title: "Aufnahme", createdAt: now, updatedAt: now })
    .run();

  const recording = createRecording(userId, "note", noteId, {
    mimeType: "audio/ogg;codecs=opus",
    startedAt: now,
  });
  appendChunk(userId, recording.id, 0, Buffer.from("OggS-fake-bytes"));
  if (options?.ready !== false) {
    completeRecording(userId, recording.id, options?.durationMs ?? 5_000);
  }
  return recording.id;
}

function jobIdFor(recordingId: string): string {
  return getRawDb().exec(`SELECT id FROM transcription_jobs WHERE recording_id = '${recordingId}'`)[0]
    .values[0][0] as string;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDb();
});

beforeEach(async () => {
  await initDb();
  runMigration();
  adminId = await seedUser("srv_admin", true);
  ownerId = await seedUser("srv_owner", false);
  adminToken = await login("srv_admin@test.com");
  ownerToken = await login("srv_owner@test.com");
});

describe("Migration 0017", () => {
  it("transcription_jobs bekommt eine epoch-Spalte mit Default 0", () => {
    const columns = getRawDb().exec("PRAGMA table_info(transcription_jobs)")[0].values;
    const epoch = columns.find((column) => column[1] === "epoch");
    expect(epoch).toBeDefined();
    expect(epoch?.[3]).toBe(1); // NOT NULL
    expect(String(epoch?.[4])).toBe("0");

    const recordingId = seedAudioJob(ownerId);
    const jobId = jobIdFor(recordingId);
    expect(getJobById(jobId)?.epoch).toBe(0);
  });
});

describe("Job-Revision und Revocation", () => {
  it("übernimmt einen Job und entzieht dem Client das Schreibrecht", async () => {
    const recordingId = seedAudioJob(ownerId);
    const claimed = claimJob(ownerId, "client-a");
    expect(claimed?.job.recordingId).toBe(recordingId);
    const jobId = claimed!.job.id;
    const clientEpoch = claimed!.job.epoch;

    const takenOver = takeOverJob(jobId);
    expect(takenOver?.job.epoch).toBe(clientEpoch + 1);
    expect(takenOver?.job.claimedBy).toBe("server");

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/transcription/jobs/${jobId}`,
      headers: headers(ownerToken),
      payload: { status: "running", progressMs: 100, epoch: clientEpoch },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("JOB_REVOKED");

    const staleSegments = await app.inject({
      method: "PUT",
      url: `/api/recordings/${recordingId}/segments`,
      headers: headers(ownerToken),
      payload: { segments: [{ startMs: 0, endMs: 900, text: "Alt." }], epoch: clientEpoch },
    });
    expect(staleSegments.statusCode).toBe(409);
    expect(staleSegments.json().error.code).toBe("JOB_REVOKED");

    const freshSegments = await app.inject({
      method: "PUT",
      url: `/api/recordings/${recordingId}/segments`,
      headers: headers(ownerToken),
      payload: { segments: [{ startMs: 0, endMs: 900, text: "Neu." }], epoch: takenOver!.job.epoch },
    });
    expect(freshSegments.statusCode).toBe(200);
    expect(getJobById(jobId)?.status).toBe("done");
  });

  it("lässt Altclients ohne Revision weiterarbeiten", async () => {
    const recordingId = seedAudioJob(ownerId);
    const claimed = claimJob(ownerId, "client-legacy");
    const jobId = claimed!.job.id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/transcription/jobs/${jobId}`,
      headers: headers(ownerToken),
      payload: { status: "running", progressMs: 50 },
    });
    expect(patched.statusCode).toBe(200);

    const segments = await app.inject({
      method: "PUT",
      url: `/api/recordings/${recordingId}/segments`,
      headers: headers(ownerToken),
      payload: { segments: [{ startMs: 0, endMs: 500, text: "Ohne Revision." }] },
    });
    expect(segments.statusCode).toBe(200);
  });
});

describe("Warteschlange des Nachtlaufs", () => {
  it("nimmt Offenes, Totes und Fehlgeschlagenes – nicht aber laufende Clients oder Erledigtes", () => {
    const pendingId = seedAudioJob(ownerId);
    const runningId = seedAudioJob(ownerId);
    const deadId = seedAudioJob(ownerId);
    const failedId = seedAudioJob(ownerId);
    const doneId = seedAudioJob(ownerId);
    const uploadingId = seedAudioJob(ownerId, { ready: false });

    // laufender Client mit frischem Heartbeat
    getRawDb().run(
      "UPDATE transcription_jobs SET status = 'running', lease_until = ? WHERE recording_id = ?",
      [Date.now() + 120_000, runningId]
    );

    // abgestürzter Tab: Status running, letzter Heartbeat 30 Minuten alt
    getRawDb().run(
      "UPDATE transcription_jobs SET status = 'running', updated_at = ? WHERE recording_id = ?",
      [Date.now() - 30 * 60_000, deadId]
    );

    getRawDb().run("UPDATE transcription_jobs SET status = 'failed', error = 'kaputt' WHERE recording_id = ?", [
      failedId,
    ]);
    getRawDb().run("UPDATE transcription_jobs SET status = 'done' WHERE recording_id = ?", [doneId]);

    const queue = listServerQueue();
    const recordingIds = queue.map((entry) => entry.recording.id);
    expect(recordingIds).toContain(pendingId);
    expect(recordingIds).toContain(deadId);
    expect(recordingIds).toContain(failedId);
    expect(recordingIds).not.toContain(runningId);
    expect(recordingIds).not.toContain(doneId);
    expect(recordingIds).not.toContain(uploadingId);
  });

  it("gibt hängende Jobs frei und markiert abgebrochene Uploads", () => {
    const recordingId = seedAudioJob(ownerId);
    const jobId = jobIdFor(recordingId);
    getRawDb().run(
      "UPDATE transcription_jobs SET status = 'running', lease_until = ? WHERE id = ?",
      [Date.now() - 60_000, jobId]
    );

    const abandonedRecording = seedAudioJob(ownerId, { ready: false });
    getRawDb().run("UPDATE recordings SET created_at = ? WHERE id = ?", [
      Date.now() - 15 * 24 * 60 * 60_000,
      abandonedRecording,
    ]);

    const result = sweepStaleJobs();
    expect(result.released).toBe(1);
    expect(result.abandonedUploads).toBe(1);
    expect(getJobById(jobId)?.status).toBe("pending");

    const status = getRawDb().exec(`SELECT status FROM recordings WHERE id = '${abandonedRecording}'`)[0].values[0][0];
    expect(status).toBe("failed");
  });
});

/** 03:00 in Europe/Berlin – im Zeitfenster des Nachtlaufs, unabhängig von der Testuhr. */
const NIGHT = () => new Date("2026-07-14T01:00:00Z");

describe("Nachtlauf", () => {
  const stubEngine = (calls: string[]): TranscriptionEngine => ({
    loaded: true,
    async transcribe(request) {
      calls.push(request.filePath);
      return [{ startMs: 0, endMs: 1_200, text: "Vom Server." }];
    },
    async dispose() {
      /* nichts */
    },
  });

  it("schreibt Segmente und beendet die Jobs", async () => {
    const first = seedAudioJob(ownerId);
    const second = seedAudioJob(adminId);
    const calls: string[] = [];

    const summary = await runTranscriptionBatch({
      triggeredBy: "admin",
      engine: stubEngine(calls),
      log: () => {},
    });

    expect(summary.processed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(calls).toHaveLength(2);

    for (const recordingId of [first, second]) {
      expect(getJobById(jobIdFor(recordingId))?.status).toBe("done");
      const segments = getRawDb().exec(
        `SELECT text FROM transcript_segments WHERE recording_id = '${recordingId}'`
      )[0].values;
      expect(segments[0][0]).toBe("Vom Server.");
    }

    expect(readLastRun()?.processed).toBe(2);
    expect(listServerQueue()).toHaveLength(0);
  });

  it("markiert einen Job als fehlgeschlagen und macht mit dem nächsten weiter", async () => {
    const broken = seedAudioJob(ownerId);
    const working = seedAudioJob(ownerId);
    const failing: TranscriptionEngine = {
      loaded: true,
      async transcribe(request) {
        if (request.filePath.includes(broken)) throw new Error("Decoder kaputt");
        return [{ startMs: 0, endMs: 1, text: "Geht." }];
      },
      async dispose() {
        /* nichts */
      },
    };

    const summary = await runTranscriptionBatch({
      triggeredBy: "schedule",
      engine: failing,
      log: () => {},
      now: NIGHT,
    });

    expect(summary.processed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(getJobById(jobIdFor(broken))?.status).toBe("failed");
    expect(getJobById(jobIdFor(broken))?.error).toContain("Decoder kaputt");
    expect(getJobById(jobIdFor(working))?.status).toBe("done");
  });

  it("respektiert das Zeitbudget", async () => {
    seedAudioJob(ownerId);
    const calls: string[] = [];
    const summary = await runTranscriptionBatch({
      triggeredBy: "schedule",
      engine: stubEngine(calls),
      budgetMs: 0,
      log: () => {},
      now: NIGHT,
    });

    expect(summary.processed).toBe(0);
    expect(summary.stoppedBy).toBe("budget");
    expect(calls).toHaveLength(0);
  });

  it("arbeitet auch ohne Modellprüfung, wenn eine Engine injiziert ist", async () => {
    seedAudioJob(ownerId);
    const summary = await runTranscriptionBatch({
      triggeredBy: "schedule",
      engine: { loaded: false, transcribe: async () => [], dispose: async () => {} },
      log: () => {},
      now: NIGHT,
    });
    expect(summary.processed).toBe(1);
  });
});

describe("Scheduler-Zeit", () => {
  it("berechnet den nächsten 3-Uhr-Punkt in Europe/Berlin", () => {
    // 01:00 UTC = 03:00 Berlin (Sommerzeit) – nächster Lauf ist der Folgetag.
    const next = nextRunAt(new Date("2026-07-14T01:00:00Z"), "03:00", "Europe/Berlin");
    expect(next.toISOString()).toBe("2026-07-15T01:00:00.000Z");

    const sameDay = nextRunAt(new Date("2026-07-14T00:30:00Z"), "03:00", "Europe/Berlin");
    expect(sameDay.toISOString()).toBe("2026-07-14T01:00:00.000Z");
  });

  it("bleibt über die Zeitumstellung korrekt", () => {
    // Winterzeit: 03:00 Berlin = 02:00 UTC.
    const winter = nextRunAt(new Date("2026-01-10T12:00:00Z"), "03:00", "Europe/Berlin");
    expect(winter.toISOString()).toBe("2026-01-11T02:00:00.000Z");

    // Tag der Umstellung (29.03.2026, 02:00 → 03:00): 03:00 existiert als CEST.
    const dstDay = zonedTimeToInstant(2026, 3, 29, 3, 0, "Europe/Berlin");
    expect(dstDay.toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("holt nur zwischen 03:00 und 06:00 nach und nicht zweimal am Tag", () => {
    const lastNight = new Date("2026-07-13T01:00:00Z");
    expect(shouldCatchUp(new Date("2026-07-14T02:00:00Z"), "03:00", "06:00", "Europe/Berlin", lastNight)).toBe(true);
    expect(shouldCatchUp(new Date("2026-07-14T07:00:00Z"), "03:00", "06:00", "Europe/Berlin", lastNight)).toBe(false);
    expect(
      shouldCatchUp(new Date("2026-07-14T02:00:00Z"), "03:00", "06:00", "Europe/Berlin", new Date("2026-07-14T01:00:00Z"))
    ).toBe(false);
  });

  it("kennt den Kalendertag in der Zeitzone", () => {
    expect(zonedDateKey(new Date("2026-07-13T22:30:00Z"), "Europe/Berlin")).toBe("2026-07-14");
  });
});

describe("Segmentierung (Parität zum Client)", () => {
  it("gruppiert Wörter zu Sätzen wie web/src/asr/transcription.ts", () => {
    const words = [
      { text: "Hallo", start_time: 0, end_time: 0.4 },
      { text: "Welt.", start_time: 0.4, end_time: 0.9 },
      { text: "Zweiter", start_time: 0.9, end_time: 1.4 },
      { text: "Satz!", start_time: 1.4, end_time: 1.9 },
    ];
    const chunks = splitSentences(words);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ text: "Hallo Welt.", timestamp: [0, 0.9] });

    const segments = buildSegments(words, [], "", 2_000);
    expect(segments).toEqual([
      { startMs: 0, endMs: 900, text: "Hallo Welt." },
      { startMs: 900, endMs: 1_900, text: "Zweiter Satz!" },
    ]);
  });

  it("bricht nach 24 Wörtern ohne Satzzeichen", () => {
    const words = Array.from({ length: 26 }, (_, index) => ({
      text: `w${index}`,
      start_time: index,
      end_time: index + 1,
    }));
    expect(splitSentences(words)).toHaveLength(2);
  });

  it("fällt auf den Gesamttext zurück", () => {
    expect(buildSegments([], [], "  Nur Text.  ", 4_321)).toEqual([
      { startMs: 0, endMs: 4_321, text: "Nur Text." },
    ]);
    expect(buildSegments([], [], "", 1_000)).toEqual([]);
  });
});

describe("Admin-Status", () => {
  it("verlangt Admin-Rechte", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/transcription/server" });
    expect(anonymous.statusCode).toBe(401);

    const simple = await app.inject({
      method: "GET",
      url: "/api/transcription/server",
      headers: headers(ownerToken),
    });
    expect(simple.statusCode).toBe(403);
  });

  it("liefert Zeitplan, Warteschlange, Modellstatus und Verlauf", async () => {
    seedAudioJob(ownerId);
    const res = await app.inject({
      method: "GET",
      url: "/api/transcription/server",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(false);
    expect(body.schedule.at).toBe("03:00");
    expect(body.schedule.timeZone).toBe("Europe/Berlin");
    expect(body.queue.pending).toBe(1);
    expect(body.model.totalBytes).toBeGreaterThan(600_000_000);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toHaveProperty("attempts");
  });

  it("startet ohne TRANSCRIBE_SERVER keinen Lauf", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/transcription/server/run",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TRANSCRIPTION_DISABLED");
  });

  it("verlangt Admin-Rechte für den Start", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/transcription/server/run",
      headers: headers(ownerToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
