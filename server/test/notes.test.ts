import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { users } from "../src/db/schema.js";
import { v7 as uuid } from "uuid";
import { scrypt, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => (err ? reject(err) : resolve(salt + ":" + k.toString("hex"))));
  });
}

let app: FastifyInstance;
let ownerToken: string;
let otherToken: string;
let adminToken: string;

function headers(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const accounts = [
    { email: "owner@test.com", username: "owner", displayName: "Owner", isAdmin: false },
    { email: "other@test.com", username: "other", displayName: "Other", isAdmin: false },
    { email: "admin@test.com", username: "admin", displayName: "Admin", isAdmin: true },
  ];

  for (const account of accounts) {
    const salt = randomBytes(16).toString("hex");
    const pw = await hashPassword("notizpass123", salt);
    db.insert(users)
      .values({
        id: uuid(),
        username: account.username,
        email: account.email,
        passwordHash: pw,
        displayName: account.displayName,
        isAdmin: account.isAdmin,
        createdAt: new Date(),
      })
      .run();
  }

  app = await buildApp();
  await app.ready();

  ownerToken = await login("owner@test.com", "notizpass123");
  otherToken = await login("other@test.com", "notizpass123");
  adminToken = await login("admin@test.com", "notizpass123");
});

async function createNote(token: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/notes",
    headers: headers(token),
    payload,
  });
}

describe("Notizen – CRUD und Privatheit", () => {
  it("legt eine Text-Notiz an und leitet den Titel aus dem Text ab", async () => {
    const res = await createNote(ownerToken, {
      kind: "text",
      body: "Erster Gedanke\nzweite Zeile",
    });
    expect(res.statusCode).toBe(201);
    const note = res.json();
    expect(note.kind).toBe("text");
    expect(note.title).toBe("Erster Gedanke");
    expect(note.userId).toBeTruthy();
  });

  it("verlangt bei Text-Notizen einen Text", async () => {
    const res = await createNote(ownerToken, { kind: "text", body: "   " });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("zeigt fremden Nutzern und Admins nichts", async () => {
    const created = await createNote(ownerToken, { kind: "text", body: "geheim" });
    const noteId = created.json().id as string;

    for (const token of [otherToken, adminToken]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/notes/${noteId}`,
        headers: headers(token),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it("aktualisiert den Titel, aber keinen Text an Audio-Notizen", async () => {
    const text = await createNote(ownerToken, { kind: "text", body: "alt" });
    const textId = text.json().id as string;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/notes/${textId}`,
      headers: headers(ownerToken),
      payload: { title: "neu", body: "geändert" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toBe("neu");
    expect(patched.json().body).toBe("geändert");

    const audio = await createNote(ownerToken, { kind: "audio", title: "Aufnahme" });
    const audioId = audio.json().id as string;
    const rejected = await app.inject({
      method: "PATCH",
      url: `/api/notes/${audioId}`,
      headers: headers(ownerToken),
      payload: { body: "darf nicht" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("BODY_NOT_EDITABLE");
  });

  it("filtert offene Aufnahmen und sucht im Transkript", async () => {
    const created = await createNote(ownerToken, { kind: "audio", title: "Suchkandidat" });
    const noteId = created.json().id as string;

    const open = await app.inject({
      method: "GET",
      url: "/api/notes?filter=open",
      headers: headers(ownerToken),
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().items.some((item: { id: string }) => item.id === noteId)).toBe(true);

    const text = await createNote(ownerToken, { kind: "text", body: "Wanderung im Harz" });
    const search = await app.inject({
      method: "GET",
      url: "/api/notes?q=Harz",
      headers: headers(ownerToken),
    });
    const ids = search.json().items.map((item: { id: string }) => item.id);
    expect(ids).toContain(text.json().id);
    expect(ids).not.toContain(noteId);
  });
});

describe("Aufnahme – Chunks, Range, Segmente", () => {
  async function createAudioNote(): Promise<string> {
    const res = await createNote(ownerToken, { kind: "audio", title: "Testaufnahme" });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  function putChunk(recordingId: string, seq: number, body: Buffer) {
    return app.inject({
      method: "PUT",
      url: `/api/recordings/${recordingId}/chunks?seq=${seq}`,
      headers: { ...headers(ownerToken), "content-type": "application/octet-stream" },
      payload: body,
    });
  }

  it("nimmt Chunks der Reihe nach an, wiederholt sie idempotent und erkennt Lücken", async () => {
    const noteId = await createAudioNote();
    const created = await app.inject({
      method: "POST",
      url: `/api/notes/${noteId}/recordings`,
      headers: headers(ownerToken),
      payload: { mimeType: "audio/ogg;codecs=opus", startedAt: new Date().toISOString() },
    });
    expect(created.statusCode).toBe(201);
    const recording = created.json();
    expect(recording.expectedSeq).toBe(0);

    const first = await putChunk(recording.id, 0, Buffer.from("AAAA"));
    expect(first.statusCode).toBe(201);
    expect(first.json().chunkCount).toBe(1);

    const repeated = await putChunk(recording.id, 0, Buffer.from("AAAA"));
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().duplicate).toBe(true);
    expect(repeated.json().chunkCount).toBe(1);

    const gap = await putChunk(recording.id, 5, Buffer.from("BBBB"));
    expect(gap.statusCode).toBe(409);
    expect(gap.json().error.expectedSeq).toBe(1);

    const second = await putChunk(recording.id, 1, Buffer.from("BBBB"));
    expect(second.statusCode).toBe(201);
    expect(second.json().byteSize).toBe(8);

    const complete = await app.inject({
      method: "POST",
      url: `/api/recordings/${recording.id}/complete`,
      headers: headers(ownerToken),
      payload: { durationMs: 1234 },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().byteSize).toBe(8);

    const afterComplete = await putChunk(recording.id, 2, Buffer.from("CCCC"));
    expect(afterComplete.statusCode).toBe(409);
    expect(afterComplete.json().error.code).toBe("RECORDING_COMPLETE");
  });

  it("verweigert den Abschluss, solange Bytes fehlen", async () => {
    const noteId = await createAudioNote();
    const recording = (
      await app.inject({
        method: "POST",
        url: `/api/notes/${noteId}/recordings`,
        headers: headers(ownerToken),
        payload: { mimeType: "audio/ogg;codecs=opus" },
      })
    ).json();
    await putChunk(recording.id, 0, Buffer.from("12345"));

    const tooEarly = await app.inject({
      method: "POST",
      url: `/api/recordings/${recording.id}/complete`,
      headers: headers(ownerToken),
      payload: { durationMs: 1000, byteSize: 10 },
    });
    expect(tooEarly.statusCode).toBe(409);
    expect(tooEarly.json().error.code).toBe("UPLOAD_INCOMPLETE");

    const complete = await app.inject({
      method: "POST",
      url: `/api/recordings/${recording.id}/complete`,
      headers: headers(ownerToken),
      payload: { durationMs: 1000, byteSize: 5 },
    });
    expect(complete.statusCode).toBe(200);
  });

  it("liefert Audio mit Range-Unterstützung über ein Abspiel-Token", async () => {
    const noteId = await createAudioNote();
    const recording = (
      await app.inject({
        method: "POST",
        url: `/api/notes/${noteId}/recordings`,
        headers: headers(ownerToken),
        payload: { mimeType: "audio/ogg;codecs=opus" },
      })
    ).json();
    await putChunk(recording.id, 0, Buffer.from("0123456789"));
    await app.inject({
      method: "POST",
      url: `/api/recordings/${recording.id}/complete`,
      headers: headers(ownerToken),
      payload: { durationMs: 1000 },
    });

    const tokenRes = await app.inject({
      method: "POST",
      url: `/api/recordings/${recording.id}/playback-token`,
      headers: headers(ownerToken),
    });
    expect(tokenRes.statusCode).toBe(200);
    const url = tokenRes.json().url as string;

    const full = await app.inject({ method: "GET", url });
    expect(full.statusCode).toBe(200);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.rawPayload.toString()).toBe("0123456789");

    const partial = await app.inject({ method: "GET", url, headers: { range: "bytes=2-5" } });
    expect(partial.statusCode).toBe(206);
    expect(partial.headers["content-range"]).toBe("bytes 2-5/10");
    expect(partial.rawPayload.toString()).toBe("2345");

    const unsatisfiable = await app.inject({ method: "GET", url, headers: { range: "bytes=99-120" } });
    expect(unsatisfiable.statusCode).toBe(416);

    const unauthenticated = await app.inject({
      method: "GET",
      url: `/api/recordings/${recording.id}/audio`,
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it("übernimmt Segmente und schließt den Job ab", async () => {
    const noteId = await createAudioNote();
    const recording = (
      await app.inject({
        method: "POST",
        url: `/api/notes/${noteId}/recordings`,
        headers: headers(ownerToken),
        payload: { mimeType: "audio/ogg;codecs=opus" },
      })
    ).json();
    await putChunk(recording.id, 0, Buffer.from("X"));
    await app.inject({
      method: "POST",
      url: `/api/recordings/${recording.id}/complete`,
      headers: headers(ownerToken),
      payload: { durationMs: 2000 },
    });

    // Der Claim greift den ältesten offenen Job des Nutzers – hier können noch
    // Jobs aus früheren Tests offen sein, also weiterclaimen bis unserer dran ist.
    let claimedJob: { recordingId: string } | null = null;
    for (let attempt = 0; attempt < 10 && !claimedJob; attempt++) {
      const claimed = await app.inject({
        method: "POST",
        url: "/api/transcription/jobs/claim",
        headers: headers(ownerToken),
        payload: { deviceId: "test-device" },
      });
      if (claimed.statusCode === 204) break;
      expect(claimed.statusCode).toBe(201);
      const job = claimed.json().job as { recordingId: string };
      if (job.recordingId === recording.id) claimedJob = job;
    }
    expect(claimedJob?.recordingId).toBe(recording.id);

    const segments = await app.inject({
      method: "PUT",
      url: `/api/recordings/${recording.id}/segments`,
      headers: headers(ownerToken),
      payload: {
        segments: [
          { startMs: 0, endMs: 800, text: "Erster Satz." },
          { startMs: 800, endMs: 1900, text: "Zweiter Satz." },
        ],
      },
    });
    expect(segments.statusCode).toBe(200);
    expect(segments.json().segments).toHaveLength(2);

    const detail = await app.inject({
      method: "GET",
      url: `/api/notes/${noteId}`,
      headers: headers(ownerToken),
    });
    const detailBody = detail.json();
    expect(detailBody.recordings[0].job.status).toBe("done");
    expect(detailBody.recordings[0].segments[0].text).toBe("Erster Satz.");

    const noMore = await app.inject({
      method: "POST",
      url: "/api/transcription/jobs/claim",
      headers: headers(ownerToken),
      payload: { deviceId: "test-device" },
    });
    expect(noMore.statusCode).toBe(204);
  });

  it("löscht Notiz, Aufnahme, Segmente und Job", async () => {
    const noteId = await createAudioNote();
    const recording = (
      await app.inject({
        method: "POST",
        url: `/api/notes/${noteId}/recordings`,
        headers: headers(ownerToken),
        payload: { mimeType: "audio/ogg;codecs=opus" },
      })
    ).json();
    await putChunk(recording.id, 0, Buffer.from("Z"));

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/notes/${noteId}`,
      headers: headers(ownerToken),
    });
    expect(deleted.statusCode).toBe(200);

    const gone = await app.inject({
      method: "GET",
      url: `/api/notes/${noteId}`,
      headers: headers(ownerToken),
    });
    expect(gone.statusCode).toBe(404);
  });
});
