import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { v7 as uuid } from "uuid";
import { scrypt, randomBytes } from "node:crypto";
import { users } from "../src/db/schema.js";
import type { FastifyInstance } from "fastify";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => (err ? reject(err) : resolve(salt + ":" + k.toString("hex"))));
  });
}

let app: FastifyInstance;
let token: string;
let userId: string;

const CAPACITY = { mon: 5, tue: 4, wed: 3, thu: 4, fri: 4, sat: 0, sun: 0 };

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const salt = randomBytes(16).toString("hex");
  const pw = await hashPassword("admin123admin", salt);
  userId = uuid();

  db.insert(users).values({
    id: userId,
    username: "planadmin",
    email: "planadmin@test.com",
    passwordHash: pw,
    displayName: "Plan Admin",
    isAdmin: true,
    capacity: JSON.stringify(CAPACITY),
    createdAt: new Date(),
  }).run();

  app = await buildApp();
  await app.ready();

  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "planadmin@test.com", password: "admin123admin" },
  });
  token = login.json().accessToken;
});

afterAll(async () => {
  await app.close();
  closeDb();
});

function headers() {
  return { authorization: `Bearer ${token}` };
}

const createTask = async (payload: Record<string, unknown>) => {
  const res = await app.inject({ method: "POST", url: "/api/tasks", headers: headers(), payload });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; title: string; [key: string]: unknown };
};

const deleteTask = async (id: string) => {
  await app.inject({ method: "DELETE", url: `/api/tasks/${id}`, headers: headers() });
};

describe("plannedDate in tasks", () => {
  it("creates a task with plannedDate", async () => {
    const planned = new Date(Date.now() + 86400000 * 2).toISOString();
    const task = await createTask({ title: "Planned Task", plannedDate: planned });
    expect((task as any).plannedDate).toBeTruthy();

    const t1 = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers() });
    expect(t1.json().plannedDate).toBeTruthy();

    await deleteTask(task.id);
  });

  it("creates a task without plannedDate", async () => {
    const task = await createTask({ title: "No Plan" });
    const t1 = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers() });
    expect(t1.json().plannedDate).toBeNull();
    await deleteTask(task.id);
  });

  it("updates plannedDate", async () => {
    const task = await createTask({ title: "Update Plan" });
    const planned = new Date(Date.now() + 86400000 * 3).toISOString();

    await app.inject({
      method: "PUT", url: `/api/tasks/${task.id}`,
      headers: headers(), payload: { plannedDate: planned },
    });

    const t1 = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers() });
    expect(t1.json().plannedDate).toBeTruthy();
    await deleteTask(task.id);
  });

  it("clears plannedDate with null", async () => {
    const planned = new Date(Date.now() + 86400000 * 2).toISOString();
    const task = await createTask({ title: "Clear Plan", plannedDate: planned });

    await app.inject({
      method: "PUT", url: `/api/tasks/${task.id}`,
      headers: headers(), payload: { plannedDate: null },
    });

    const t1 = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers() });
    expect(t1.json().plannedDate).toBeNull();
    await deleteTask(task.id);
  });
});

describe("GET /api/planning", () => {
  it("returns tasks, days, and null draft", async () => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6).toISOString();

    const res = await app.inject({
      method: "GET", url: `/api/planning?from=${from}&to=${to}`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(Array.isArray(body.days)).toBe(true);
    expect(body.days.length).toBe(7);
    expect(body.draft).toBeNull();

    for (const day of body.days) {
      expect(day).toHaveProperty("date");
      expect(day).toHaveProperty("weekday");
      expect(day).toHaveProperty("capacity");
      expect(day).toHaveProperty("usedSp");
      expect(day).toHaveProperty("taskCount");
      expect(day).toHaveProperty("overloaded");
    }
  });

  it("uses user capacity for weekday load", async () => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6).toISOString();

    const res = await app.inject({
      method: "GET", url: `/api/planning?from=${from}&to=${to}`,
      headers: headers(),
    });

    const days = res.json().days;
    const monday = days.find((d: { weekday: string }) => d.weekday === "mon");
    if (monday) expect(monday.capacity).toBe(5);
  });
});

describe("Planning draft", () => {
  it("saves and loads draft", async () => {
    const task = await createTask({ title: "Draft Task" });
    const planned = new Date(Date.now() + 86400000).toISOString();

    const save = await app.inject({
      method: "PUT", url: "/api/planning/draft",
      headers: headers(),
      payload: { changes: { [task.id]: planned } },
    });
    expect(save.statusCode).toBe(200);

    const load = await app.inject({
      method: "GET", url: "/api/planning?from=2026-01-01&to=2026-01-07",
      headers: headers(),
    });
    const draft = load.json().draft;
    expect(draft).not.toBeNull();
    expect(draft.changes[task.id]).toBe(planned);

    await deleteTask(task.id);

    await app.inject({
      method: "DELETE", url: "/api/planning/draft",
      headers: headers(),
    });
  });

  it("discards draft", async () => {
    const task = await createTask({ title: "Discard Task" });

    await app.inject({
      method: "PUT", url: "/api/planning/draft",
      headers: headers(),
      payload: { changes: { [task.id]: new Date().toISOString() } },
    });

    await app.inject({
      method: "DELETE", url: "/api/planning/draft",
      headers: headers(),
    });

    const load = await app.inject({
      method: "GET", url: "/api/planning?from=2026-01-01&to=2026-01-07",
      headers: headers(),
    });
    expect(load.json().draft).toBeNull();

    await deleteTask(task.id);
  });

  it("confirms planning and applies plannedDate", async () => {
    const task = await createTask({ title: "Confirm Task" });
    const planned = new Date(Date.now() + 86400000 * 2).toISOString();

    await app.inject({
      method: "PUT", url: "/api/planning/draft",
      headers: headers(),
      payload: { changes: { [task.id]: planned } },
    });

    const confirm = await app.inject({
      method: "POST", url: "/api/planning/confirm",
      headers: headers(),
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().updated).toBe(1);

    const t1 = await app.inject({
      method: "GET", url: `/api/tasks/${task.id}`,
      headers: headers(),
    });
    expect(t1.json().plannedDate).toBeTruthy();

    const draftCheck = await app.inject({
      method: "GET", url: "/api/planning?from=2026-01-01&to=2026-01-07",
      headers: headers(),
    });
    expect(draftCheck.json().draft).toBeNull();

    await deleteTask(task.id);
  });
});

describe("Load calculation", () => {
  it("calculates usedSp from pomodoros", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const planned = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()).toISOString();

    const task = await createTask({ title: "Load Test", pomodoros: 5, plannedDate: planned });

    const from = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()).toISOString();
    const to = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()).toISOString();

    const res = await app.inject({
      method: "GET", url: `/api/planning?from=${from}&to=${to}`,
      headers: headers(),
    });

    const day = res.json().days[0];
    expect(day.usedSp).toBe(5);

    await deleteTask(task.id);
  });

  it("detects overloaded days", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const planned = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()).toISOString();

    const task = await createTask({ title: "Overload Test", pomodoros: 10, plannedDate: planned });

    const from = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()).toISOString();
    const to = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()).toISOString();

    const res = await app.inject({
      method: "GET", url: `/api/planning?from=${from}&to=${to}`,
      headers: headers(),
    });

    const day = res.json().days[0];
    expect(day.overloaded).toBe(true);

    await deleteTask(task.id);
  });
});
