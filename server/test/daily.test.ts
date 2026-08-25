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
    scrypt(password, salt, KEYLEN, (err, k) => err ? reject(err) : resolve(salt + ":" + k.toString("hex")));
  });
}

const isoDate = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();

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
  const pw = await hashPassword("dailyuser123", salt);

  db.insert(users).values({
    id: uuid(), username: "dailyuser", email: "daily@test.com",
    passwordHash: pw, displayName: "Daily User", isAdmin: false, createdAt: new Date(),
  }).run();

  app = await buildApp();
  await app.ready();

  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "daily@test.com", password: "dailyuser123" },
  });
  token = login.json().accessToken;
});

async function createTask(payload: Record<string, unknown>): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/api/tasks",
    headers: headers(token),
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function getDaily(date: string) {
  const res = await app.inject({
    method: "GET", url: `/api/daily?date=${date}`,
    headers: headers(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("daily overdue list", () => {
  const selected = "2026-01-10";

  let overdueTask: string;
  let dueTodayTask: string;
  let futureTask: string;
  let doneTask: string;
  let plannedTask: string;
  let habitTask: string;

  beforeAll(async () => {
    overdueTask = await createTask({ title: "Overdue", dueAt: isoDate(new Date(2026, 0, 1)) });
    dueTodayTask = await createTask({ title: "Due today", dueAt: isoDate(new Date(2026, 0, 10)) });
    futureTask = await createTask({ title: "Future", dueAt: isoDate(new Date(2026, 1, 1)) });
    doneTask = await createTask({ title: "Done", dueAt: isoDate(new Date(2026, 0, 5)) });
    plannedTask = await createTask({ title: "Planned", plannedDate: isoDate(new Date(2026, 0, 10)) });
    habitTask = await createTask({ title: "Habit", isHabit: true, recurrenceType: "none" });

    await app.inject({
      method: "POST", url: `/api/tasks/${doneTask}/complete`,
      headers: headers(token),
      payload: {},
    });
  });

  it("includes overdue and due-on-day tasks, sorted by due date", async () => {
    const body = await getDaily(selected);
    const ids = body.overdue.map((t: { task: { id: string } }) => t.task.id);
    expect(ids).toContain(overdueTask);
    expect(ids).toContain(dueTodayTask);
    expect(ids.indexOf(overdueTask)).toBeLessThan(ids.indexOf(dueTodayTask));
  });

  it("excludes future, completed, planned-only and habit tasks", async () => {
    const body = await getDaily(selected);
    const ids = body.overdue.map((t: { task: { id: string } }) => t.task.id);
    expect(ids).not.toContain(futureTask);
    expect(ids).not.toContain(doneTask);
    expect(ids).not.toContain(plannedTask);
    expect(ids).not.toContain(habitTask);
  });

  it("day list still contains due and planned tasks", async () => {
    const body = await getDaily(selected);
    const ids = body.tasks.map((t: { task: { id: string } }) => t.task.id);
    expect(ids).toContain(dueTodayTask);
    expect(ids).toContain(plannedTask);
    expect(ids).not.toContain(overdueTask);
  });

  it("is empty for a date before all tasks", async () => {
    const body = await getDaily("2025-12-01");
    expect(body.overdue).toEqual([]);
  });
});
