import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { v7 as uuid } from "uuid";
import { scrypt, randomBytes } from "node:crypto";
import { users, tasks } from "../src/db/schema.js";
import type { FastifyInstance } from "fastify";

const KEYLEN = 64;
function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => (err ? reject(err) : resolve(salt + ":" + k.toString("hex"))));
  });
}

let app: FastifyInstance;
let token: string;
const userId = uuid();

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const salt = randomBytes(16).toString("hex");
  const pw = await hashPassword("test123456", salt);
  db.insert(users).values({
    id: userId, username: "rectest", email: "rec@test.com",
    passwordHash: pw, displayName: "Rec Test", isAdmin: true, createdAt: new Date(),
  }).run();

  app = await buildApp();
  await app.ready();

  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "rec@test.com", password: "test123456" },
  });
  token = login.json().accessToken;
});

afterAll(async () => {
  await app.close();
  closeDb();
});

function h() { return { authorization: `Bearer ${token}` }; }

describe("Completion + Recurrence", () => {
  it("complete non-recurring task marks it done", async () => {
    const create = await app.inject({ method: "POST", url: "/api/tasks", headers: h(), payload: { title: "Einmalig" } });
    const taskId = create.json().id;

    const res = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/complete`, headers: h(), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().completed).toBe(true);

    const get = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: h() });
    expect(get.json().isCompleted).toBe(true);
  });

  it("complete rrule task advances to next occurrence", async () => {
    const now = new Date();
    const dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 20, 0, 0); // yesterday 20:00
    const create = await app.inject({
      method: "POST", url: "/api/tasks", headers: h(),
      payload: {
        title: "Wöchentlich",
        dueAt: dueDate.toISOString(),
        recurrenceType: "rrule",
        recurrenceRule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=WE",
      },
    });
    const taskId = create.json().id;

    const res = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/complete`, headers: h(), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().completed).toBe(true);
    expect(res.json().nextDueAt).not.toBeNull();

    const get = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: h() });
    expect(get.json().isCompleted).toBe(false);
  });

  it("complete on_completion requires nextDueAt", async () => {
    const create = await app.inject({
      method: "POST", url: "/api/tasks", headers: h(),
      payload: { title: "Bei Erledigung", recurrenceType: "on_completion" },
    });
    const taskId = create.json().id;

    const fail = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/complete`, headers: h(), payload: {} });
    expect(fail.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST", url: `/api/tasks/${taskId}/complete`, headers: h(),
      payload: { nextDueAt: new Date(Date.now() + 86400000).toISOString() },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().completed).toBe(true);
  });

  it("reopen completed task", async () => {
    const create = await app.inject({ method: "POST", url: "/api/tasks", headers: h(), payload: { title: "Reopen" } });
    const taskId = create.json().id;

    await app.inject({ method: "POST", url: `/api/tasks/${taskId}/complete`, headers: h(), payload: {} });
    const reopen = await app.inject({ method: "POST", url: `/api/tasks/${taskId}/reopen`, headers: h() });
    expect(reopen.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: `/api/tasks/${taskId}`, headers: h() });
    expect(get.json().isCompleted).toBe(false);
  });
});

describe("Calendar", () => {
  it("returns tasks with due dates in range", async () => {
    const now = new Date();
    const create = await app.inject({
      method: "POST", url: "/api/tasks", headers: h(),
      payload: { title: "Kalender-Task", dueAt: now.toISOString() },
    });
    expect(create.statusCode).toBe(201);

    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
    const res = await app.inject({ method: "GET", url: `/api/calendar?from=${from}&to=${to}`, headers: h() });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThanOrEqual(1);
  });

  it("generates occurrences for rrule tasks", async () => {
    const start = new Date(2026, 7, 5, 20, 0, 0); // Aug 5 2026
    const create = await app.inject({
      method: "POST", url: "/api/tasks", headers: h(),
      payload: {
        title: "RRule Calendar",
        dueAt: start.toISOString(),
        recurrenceType: "rrule",
        recurrenceRule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=WE",
      },
    });
    expect(create.statusCode).toBe(201);

    const from = new Date(2026, 7, 1).toISOString();
    const to = new Date(2026, 8, 0).toISOString();
    const res = await app.inject({ method: "GET", url: `/api/calendar?from=${from}&to=${to}`, headers: h() });
    expect(res.statusCode).toBe(200);
    const items = res.json() as { title: string }[];
    expect(items.length).toBeGreaterThanOrEqual(3);
  });
});
