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
  markJobFailed,
  replaceSegmentsInternal,
  takeOverJob,
  touchJobProgress,
  updateJob,
} from "../src/modules/recordings/recordings.service.js";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => (err ? reject(err) : resolve(salt + ":" + k.toString("hex"))));
  });
}

let app: FastifyInstance;
let adminId: string;
let ownerId: string;
let otherId: string;
let adminToken: string;
let ownerToken: string;
let otherToken: string;

async function seedUser(username: string, isAdmin: boolean): Promise<string> {
  const id = uuid();
  const salt = randomBytes(16).toString("hex");
  getDb()
    .insert(users)
    .values({
      id,
      username,
      email: `${username}@test.com`,
      passwordHash: await hashPassword("audio123", salt),
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
    payload: { email, password: "audio123" },
  });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}

function headers(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Audio-Notiz + Aufnahme + Job, Upload abgeschlossen. */
function seedAudioJob(userId: string, title = "Aufnahme", durationMs = 5_000): string {
  const noteId = uuid();
  const now = new Date();
  getDb()
    .insert(notes)
    .values({ id: noteId, userId, kind: "audio", title, createdAt: now, updatedAt: now })
    .run();

  const recording = createRecording(userId, "note", noteId, { mimeType: "audio/ogg;codecs=opus", startedAt: now });
  appendChunk(userId, recording.id, 0, Buffer.from("OggS-fake-bytes"));
  completeRecording(userId, recording.id, durationMs);
  return recording.id;
}

function jobIdFor(recordingId: string): string {
  return getRawDb().exec(`SELECT id FROM transcription_jobs WHERE recording_id = '${recordingId}'`)[0]
    .values[0][0] as string;
}

function finishJob(recordingId: string, text = "Fertig."): string {
  const jobId = jobIdFor(recordingId);
  replaceSegmentsInternal(recordingId, [{ startMs: 0, endMs: 900, text }]);
  return jobId;
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
  adminId = await seedUser("aud_admin", true);
  ownerId = await seedUser("aud_owner", false);
  otherId = await seedUser("aud_other", false);
  adminToken = await login("aud_admin@test.com");
  ownerToken = await login("aud_owner@test.com");
  otherToken = await login("aud_other@test.com");
});

describe("Migration 0018", () => {
  it("transcription_jobs bekommt started_at, finished_at und engine", () => {
    const columns = getRawDb().exec("PRAGMA table_info(transcription_jobs)")[0].values;
    const byName = new Map(columns.map((column) => [column[1] as string, column]));

    for (const name of ["started_at", "finished_at", "engine"]) {
      expect(byName.get(name)).toBeDefined();
      expect(byName.get(name)?.[3]).toBe(0); // notnull = 0, also nullbar
    }
  });

  it("schreibt beim Claim eine Startzeit und die Engine", () => {
    const recordingId = seedAudioJob(ownerId);
    const claimed = claimJob(ownerId, "tab-1");
    expect(claimed?.job.engine).toBe("device");
    expect(claimed?.job.startedAt).toBeInstanceOf(Date);
    expect(getJobById(claimed!.job.id)?.startedAt).toBeInstanceOf(Date);
  });

  it("setzt beim Server-Übernehmen engine=server und beim Abschluss finished_at", () => {
    const recordingId = seedAudioJob(ownerId);
    const jobId = jobIdFor(recordingId);
    takeOverJob(jobId);
    expect(getJobById(jobId)?.engine).toBe("server");

    finishJob(recordingId);
    const job = getJobById(jobId);
    expect(job?.status).toBe("done");
    expect(job?.finishedAt).toBeInstanceOf(Date);
  });

  it("räumt die Zeiten beim erneuten Einreihen wieder ab", async () => {
    const recordingId = seedAudioJob(ownerId);
    const jobId = jobIdFor(recordingId);
    markJobFailed(jobId, "kaputt");
    expect(getJobById(jobId)?.finishedAt).toBeInstanceOf(Date);

    const res = await app.inject({
      method: "POST",
      url: "/api/transcription/requeue",
      headers: headers(ownerToken),
      payload: { scope: "mine" },
    });
    expect(res.statusCode).toBe(200);

    const job = getJobById(jobId);
    expect(job?.status).toBe("pending");
    expect(job?.startedAt).toBeNull();
    expect(job?.finishedAt).toBeNull();
  });
});

describe("Audio-Übersicht", () => {
  it("zeigt in der eigenen Sicht nur eigene Aufträge", async () => {
    seedAudioJob(ownerId, "Meine");
    seedAudioJob(otherId, "Fremde");

    const res = await app.inject({
      method: "GET",
      url: "/api/transcription/overview?scope=mine",
      headers: headers(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs.active.length).toBe(0);
    expect(body.queue.pending).toBe(1);
  });

  it("verweigert die Gesamtansicht ohne Adminrechte", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/transcription/overview?scope=all",
      headers: headers(ownerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("zeigt Admins in der Gesamtansicht alle Nutzer mit Quelle", async () => {
    finishJob(seedAudioJob(ownerId, "Meine Notiz"), "a");
    finishJob(seedAudioJob(otherId, "Fremde Notiz"), "b");

    const res = await app.inject({
      method: "GET",
      url: "/api/transcription/overview?scope=all",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const titles = body.jobs.recent.map((job: { ownerTitle: string }) => job.ownerTitle);
    expect(titles).toEqual(expect.arrayContaining(["Meine Notiz", "Fremde Notiz"]));
    expect(body.jobs.recent.every((job: { displayName?: string }) => typeof job.displayName === "string")).toBe(true);
  });

  it("liefert den Notiztitel als Quelle und einen Einstiegspunkt", async () => {
    const recordingId = seedAudioJob(ownerId, "Einkauf");
    finishJob(recordingId);

    const res = await app.inject({
      method: "GET",
      url: "/api/transcription/overview?scope=mine",
      headers: headers(ownerToken),
    });
    const body = res.json();
    expect(body.jobs.recent).toHaveLength(1);
    expect(body.jobs.recent[0].ownerTitle).toBe("Einkauf");
    expect(body.jobs.recent[0].path).toMatch(/^\/notes\?note=/);
    expect(body.recentTotal).toBe(1);
  });

  it("meldet Fortschritt nur für Server-Jobs", async () => {
    const deviceRecording = seedAudioJob(ownerId, "Browser", 5_000);
    const deviceJobId = jobIdFor(deviceRecording);
    claimJob(ownerId, "tab-1");

    const serverRecording = seedAudioJob(ownerId, "Server", 10_000);
    const serverJobId = jobIdFor(serverRecording);
    const takenOver = takeOverJob(serverJobId);
    touchJobProgress(serverJobId, 5_000, takenOver!.job.epoch);

    const res = await app.inject({
      method: "GET",
      url: "/api/transcription/overview?scope=mine",
      headers: headers(ownerToken),
    });
    const active = res.json().jobs.active as Array<{ id: string; percent: number | null }>;

    expect(active.find((job) => job.id === serverJobId)?.percent).toBeCloseTo(0.5, 5);
    expect(active.find((job) => job.id === deviceJobId)?.percent).toBeNull();
  });

  it("zählt laufende Geräte-Aufträge getrennt", async () => {
    const recordingId = seedAudioJob(ownerId);
    claimJob(ownerId, "tab-1");
    const jobId = jobIdFor(recordingId);
    touchJobProgress(jobId, 100, getJobById(jobId)!.epoch);

    const res = await app.inject({
      method: "GET",
      url: "/api/transcription/overview?scope=mine",
      headers: headers(ownerToken),
    });
    const body = res.json();
    expect(body.deviceJobs).toBe(1);
    expect(body.run).toBeNull();
  });

  it("gibt fehlgeschlagene Aufträge mit Fehlertext zurück", async () => {
    const recordingId = seedAudioJob(ownerId);
    markJobFailed(jobIdFor(recordingId), "Decoder gescheitert");

    const res = await app.inject({
      method: "GET",
      url: "/api/transcription/overview?scope=mine",
      headers: headers(ownerToken),
    });
    const body = res.json();
    expect(body.jobs.failed).toHaveLength(1);
    expect(body.jobs.failed[0].error).toBe("Decoder gescheitert");
  });
});

describe("Wieder einreihen", () => {
  it("erfasst nur eigene Aufträge", async () => {
    markJobFailed(jobIdFor(seedAudioJob(ownerId)), "mein Fehler");
    markJobFailed(jobIdFor(seedAudioJob(otherId)), "fremder Fehler");

    const res = await app.inject({
      method: "POST",
      url: "/api/transcription/requeue",
      headers: headers(ownerToken),
      payload: { scope: "mine" },
    });
    expect(res.json().requeued).toBe(1);

    const failed = getRawDb().exec("SELECT id FROM transcription_jobs WHERE status = 'failed'")[0];
    expect(failed.values).toHaveLength(1);
  });

  it("lässt Admins alle Nutzer neu einreihen", async () => {
    markJobFailed(jobIdFor(seedAudioJob(ownerId)), "a");
    markJobFailed(jobIdFor(seedAudioJob(otherId)), "b");

    const res = await app.inject({
      method: "POST",
      url: "/api/transcription/requeue",
      headers: headers(adminToken),
      payload: { scope: "all" },
    });
    expect(res.json().requeued).toBe(2);
  });

  it("verweigert das globale Einreihen ohne Adminrechte", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/transcription/requeue",
      headers: headers(ownerToken),
      payload: { scope: "all" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("erhöht die Revision, damit ein alter Tab nicht mehr schreiben darf", async () => {
    const recordingId = seedAudioJob(ownerId);
    const jobId = jobIdFor(recordingId);
    markJobFailed(jobId, "kaputt");
    const before = getJobById(jobId)!.epoch;

    await app.inject({
      method: "POST",
      url: "/api/transcription/requeue",
      headers: headers(ownerToken),
      payload: { scope: "mine" },
    });

    expect(getJobById(jobId)?.epoch).toBe(before + 1);
  });
});

describe("Migration ohne Neustart", () => {
  it("kündigt nach erfolgreicher Migration einen Neustart an", async () => {
    // app_meta wegwerfen → der Server hält die DB für migrationsbedürftig.
    getRawDb().run("DROP TABLE IF EXISTS app_meta");

    let restarts = 0;
    const maintenanceApp = await buildApp({
      migrationMode: true,
      onMigrationDone: () => {
        restarts += 1;
      },
    });
    await maintenanceApp.ready();

    try {
      const loginRes = await maintenanceApp.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "aud_admin@test.com", password: "audio123" },
      });
      expect(loginRes.statusCode).toBe(200);

      const res = await maintenanceApp.inject({
        method: "POST",
        url: "/api/migration/run",
        headers: headers(loginRes.json().accessToken as string),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().restarting).toBe(true);

      // Der Neustart wird erst nach dem Senden der Antwort ausgelöst.
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(restarts).toBe(1);
    } finally {
      await maintenanceApp.close();
    }
  });
});

describe("Statistik", () => {
  it("liefert einen leeren, aber vollständigen Tagesraster", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/stats/audio?scope=mine&range=7d",
      headers: headers(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toHaveLength(7);
    expect(body.totals.done).toBe(0);
    expect(body.totals.speedup).toBeNull();
    expect(body.perUser).toBeNull();
  });

  it("zählt fertige Aufnahmen und berechnet den Echtzeitfaktor", async () => {
    const recordingId = seedAudioJob(ownerId, "Lang", 30_000);
    const jobId = finishJob(recordingId);

    const finishedAt = new Date();
    const startedAt = new Date(finishedAt.getTime() - 10_000);
    getRawDb().run(
      "UPDATE transcription_jobs SET started_at = ?, finished_at = ?, engine = 'server' WHERE id = ?",
      [startedAt.getTime(), finishedAt.getTime(), jobId]
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/audio?scope=mine&range=7d",
      headers: headers(ownerToken),
    });
    const body = res.json();
    expect(body.totals.done).toBe(1);
    expect(body.totals.mediaMs).toBe(30_000);
    expect(body.totals.procMs).toBe(10_000);
    expect(body.totals.speedup).toBeCloseTo(3, 5);
  });

  it("verweigert die Gesamtstatistik ohne Adminrechte", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/stats/audio?scope=all&range=30d",
      headers: headers(ownerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("gruppiert für Admins pro Nutzer", async () => {
    finishJob(seedAudioJob(ownerId, "A", 10_000));
    finishJob(seedAudioJob(otherId, "B", 20_000));

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/audio?scope=all&range=7d",
      headers: headers(adminToken),
    });
    const body = res.json();
    expect(body.totals.done).toBe(2);
    expect(body.perUser).toHaveLength(2);
    expect(body.perUser[0].mediaMs).toBe(20_000);
  });

  it("weist ungültige Zeiträume ab", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/stats/audio?scope=mine&range=3",
      headers: headers(ownerToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it("meldet den Zeitraum deckungsgleich mit dem Tagesraster", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/stats/audio?scope=mine&range=7d&tz=Europe/Berlin",
      headers: headers(ownerToken),
    });
    const body = res.json();
    expect(body.range.preset).toBe("7d");
    expect(body.range.from).toBe(body.days[0].date);
    expect(body.range.to).toBe(body.days[body.days.length - 1].date);
    expect(body.range.days).toBe(7);
  });

  it("zählt Device-Fehlschläge, sobald finished_at gesetzt ist", async () => {
    seedAudioJob(ownerId, "Kaputt", 12_000);
    const claimed = claimJob(ownerId, "tab-1");
    expect(claimed).not.toBeNull();
    updateJob(ownerId, claimed!.job.id, { status: "failed", error: "decode" });

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/audio?scope=mine&range=7d",
      headers: headers(ownerToken),
    });
    const body = res.json();
    expect(body.totals.failed).toBe(1);
    expect(body.totals.done).toBe(0);
    expect(body.totals.failureRate).toBe(1);
  });

  it("trennt Server- und Geräte-Jobs", async () => {
    const deviceRecording = seedAudioJob(ownerId, "Gerät", 10_000);
    const claimed = claimJob(ownerId, "tab-1");
    expect(claimed?.job.recordingId).toBe(deviceRecording);
    finishJob(deviceRecording);

    const serverRecording = seedAudioJob(ownerId, "Server", 20_000);
    takeOverJob(jobIdFor(serverRecording));
    finishJob(serverRecording);

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/audio?scope=mine&range=7d",
      headers: headers(ownerToken),
    });
    const body = res.json();
    expect(body.totals.done).toBe(2);
    const byEngine = new Map(body.byEngine.map((entry: { engine: string }) => [entry.engine, entry]));
    expect(byEngine.get("device")?.done).toBe(1);
    expect(byEngine.get("server")?.done).toBe(1);
  });
});
