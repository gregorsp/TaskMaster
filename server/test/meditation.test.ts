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
let token: string;

function headers(t: string) {
  return { authorization: `Bearer ${t}` };
}

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const salt = randomBytes(16).toString("hex");
  const pw = await hashPassword("meditationspass", salt);
  db.insert(users)
    .values({
      id: uuid(),
      username: "meditator",
      email: "meditation@test.com",
      passwordHash: pw,
      displayName: "Meditator",
      isAdmin: false,
      createdAt: new Date(),
    })
    .run();

  app = await buildApp();
  await app.ready();

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "meditation@test.com", password: "meditationspass" },
  });
  token = login.json().accessToken;
});

describe("Meditation – Sessions und Kennzahlen", () => {
  it("legt eine Session an, ändert sie und zählt die Minuten", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/meditation/sessions",
      headers: headers(token),
      payload: { plannedDurationSec: 600, actualDurationSec: 600, note: "Ruhig", concentration: 4 },
    });
    expect(created.statusCode).toBe(201);
    const sessionId = created.json().id as string;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/meditation/sessions/${sessionId}`,
      headers: headers(token),
      payload: { note: "Sehr ruhig", endedAt: new Date().toISOString() },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().note).toBe("Sehr ruhig");

    const list = await app.inject({
      method: "GET",
      url: "/api/meditation/sessions",
      headers: headers(token),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().sessions).toHaveLength(1);
    expect(list.json().stats.totalMinutes).toBe(10);
    expect(list.json().stats.streak).toBe(1);
    expect(list.json().stats.avgConcentration).toBe(4);
  });

  it("speichert Kommentare an einer Session", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/meditation/sessions",
      headers: headers(token),
      payload: { actualDurationSec: 120 },
    });
    const sessionId = created.json().id as string;

    const comment = await app.inject({
      method: "POST",
      url: `/api/meditation/sessions/${sessionId}/comments`,
      headers: headers(token),
      payload: { text: "Gedanken kreisten um die Arbeit." },
    });
    expect(comment.statusCode).toBe(201);

    const list = await app.inject({
      method: "GET",
      url: "/api/meditation/sessions",
      headers: headers(token),
    });
    const stored = (list.json().sessions as Array<{ id: string; comments: Array<{ id: string; text: string }> }>).find(
      (session) => session.id === sessionId
    );
    expect(stored?.comments).toHaveLength(1);
    expect(stored?.comments[0].text).toContain("Arbeit");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/meditation/sessions/${sessionId}/comments/${stored?.comments[0].id}`,
      headers: headers(token),
    });
    expect(deleted.statusCode).toBe(200);

    await app.inject({
      method: "DELETE",
      url: `/api/meditation/sessions/${sessionId}`,
      headers: headers(token),
    });
  });

  it("löscht Sessions", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/meditation/sessions",
      headers: headers(token),
      payload: { actualDurationSec: 300 },
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/meditation/sessions/${created.json().id}`,
      headers: headers(token),
    });
    expect(deleted.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: "/api/meditation/sessions",
      headers: headers(token),
    });
    expect(list.json().sessions).toHaveLength(1);
  });
});
