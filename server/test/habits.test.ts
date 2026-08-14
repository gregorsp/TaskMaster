import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb } from "../src/db/client.js";
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

let app: FastifyInstance;
let userToken: string;
let user2Token: string;

const isoDate = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();

function dateOnlyString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function headers(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const salt = randomBytes(16).toString("hex");
  const pw = await hashPassword("habituser123", salt);

  db.insert(users).values({
    id: uuid(), username: "habituser", email: "habit@test.com",
    passwordHash: pw, displayName: "Habit User", isAdmin: false, createdAt: new Date(),
  }).run();

  app = await buildApp();
  await app.ready();

  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "habit@test.com", password: "habituser123" },
  });
  userToken = login.json().accessToken;

  await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username: "habituser2", email: "habit2@test.com", password: "habituser123", displayName: "Habit User 2" },
  });
  const login2 = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "habit2@test.com", password: "habituser123" },
  });
  user2Token = login2.json().accessToken;
});

afterAll(async () => {
  await app.close();
  closeDb();
});

describe("Habits", () => {
  let habitId: string;

  it("creates a habit (forced private, no recurrence, no planning)", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(userToken),
      payload: {
        title: "Wasser trinken",
        isHabit: true,
        isPrivate: false,
        recurrenceType: "rrule",
        dueAt: "2026-08-10T00:00:00.000Z",
        plannedDate: "2026-08-11T00:00:00.000Z",
        assigneeIds: [],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.isHabit).toBe(true);
    expect(body.isPrivate).toBe(true);
    expect(body.recurrenceType).toBe("none");
    expect(body.recurrenceRule).toBeNull();
    expect(body.dueAt).toBeNull();
    expect(body.plannedDate).toBeNull();
    habitId = body.id;
  });

  it("lists habits with isHabit filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/tasks?isHabit=true",
      headers: headers(userToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.some((t: { id: string }) => t.id === habitId)).toBe(true);
  });

  it("habit is only visible to its creator", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/tasks/${habitId}`,
      headers: headers(user2Token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("completes a habit for a specific date without marking the task completed", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${habitId}/complete`,
      headers: headers(userToken),
      payload: { occurrenceDate: "2026-08-11T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().completed).toBe(true);

    const task = await app.inject({
      method: "GET", url: `/api/tasks/${habitId}`,
      headers: headers(userToken),
    });
    expect(task.json().isCompleted).toBe(false);

    const occ = await app.inject({
      method: "GET", url: `/api/tasks/${habitId}/occurrences`,
      headers: headers(userToken),
    });
    const occurrences = occ.json();
    expect(occurrences.length).toBe(1);
    expect(occurrences[0].isCompleted).toBe(true);
  });

  it("daily endpoint reports the habit as completed for that date", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/daily?date=2026-08-11",
      headers: headers(userToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.date).toBe("2026-08-11");
    const habit = body.habits.find((h: { id: string }) => h.id === habitId);
    expect(habit).toBeDefined();
    expect(habit.completedOnDate).toBe(true);
  });

  it("daily endpoint reports the habit as NOT completed for another date", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/daily?date=2026-08-12",
      headers: headers(userToken),
    });
    const body = res.json();
    const habit = body.habits.find((h: { id: string }) => h.id === habitId);
    expect(habit.completedOnDate).toBe(false);
  });

  it("reopens a habit for a date (undo)", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${habitId}/reopen`,
      headers: headers(userToken),
      payload: { occurrenceDate: "2026-08-11T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);

    const daily = await app.inject({
      method: "GET", url: "/api/daily?date=2026-08-11",
      headers: headers(userToken),
    });
    const habit = daily.json().habits.find((h: { id: string }) => h.id === habitId);
    expect(habit.completedOnDate).toBe(false);
  });

  it("completes a habit with a date-only string (YYYY-MM-DD) for that exact calendar day", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${habitId}/complete`,
      headers: headers(userToken),
      payload: { occurrenceDate: "2026-08-13" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().completed).toBe(true);

    const daily = await app.inject({
      method: "GET", url: "/api/daily?date=2026-08-13",
      headers: headers(userToken),
    });
    const habit = daily.json().habits.find((h: { id: string }) => h.id === habitId);
    expect(habit).toBeDefined();
    expect(habit.completedOnDate).toBe(true);

    const other = await app.inject({
      method: "GET", url: "/api/daily?date=2026-08-14",
      headers: headers(userToken),
    });
    const otherHabit = other.json().habits.find((h: { id: string }) => h.id === habitId);
    expect(otherHabit.completedOnDate).toBe(false);
  });

  it("completes a habit without date defaults to today", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${habitId}/complete`,
      headers: headers(userToken),
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const daily = await app.inject({
      method: "GET", url: "/api/daily",
      headers: headers(userToken),
    });
    const habit = daily.json().habits.find((h: { id: string }) => h.id === habitId);
    expect(habit.completedOnDate).toBe(true);
  });

  it("daily endpoint lists due/planned normal tasks for the date", async () => {
    const createRes = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(userToken),
      payload: { title: "Heute fällig", dueAt: "2026-08-11T10:00:00.000Z" },
    });
    const taskId = createRes.json().id;

    const daily = await app.inject({
      method: "GET", url: "/api/daily?date=2026-08-11",
      headers: headers(userToken),
    });
    const body = daily.json();
    const task = body.tasks.find((t: { task: { id: string } }) => t.task.id === taskId);
    expect(task).toBeDefined();
    expect(task.type).toBe("due");
    expect(Array.isArray(task.assignees)).toBe(true);
    expect(Array.isArray(task.categories)).toBe(true);
    expect(body.habits.some((h: { id: string }) => h.id === habitId)).toBe(true);
  });

  it("converting a task to a habit clears urgency, parent, dates and forces private", async () => {
    const parentRes = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(userToken),
      payload: { title: "Parent für Konvertierung" },
    });
    const parentId = parentRes.json().id;

    const createRes = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(userToken),
      payload: {
        title: "Wird Habit",
        dueAt: "2026-08-11T10:00:00.000Z",
        plannedDate: "2026-08-12T10:00:00.000Z",
        parentId,
        urgencyMode: "always",
        urgencyValue: 3,
        isPrivate: false,
      },
    });
    const taskId = createRes.json().id;
    expect(createRes.json().parentId).toBe(parentId);
    expect(createRes.json().urgencyMode).toBe("always");

    const convRes = await app.inject({
      method: "PUT", url: `/api/tasks/${taskId}`,
      headers: headers(userToken),
      payload: { isHabit: true },
    });
    expect(convRes.statusCode).toBe(200);
    const conv = convRes.json();
    expect(conv.isHabit).toBe(true);
    expect(conv.isPrivate).toBe(true);
    expect(conv.urgencyMode).toBe("never");
    expect(conv.urgencyValue).toBeNull();
    expect(conv.parentId).toBeNull();
    expect(conv.dueAt).toBeNull();
    expect(conv.plannedDate).toBeNull();
    expect(conv.recurrenceType).toBe("none");
  });
});

describe("Habit settings (confirmHabitCompletion)", () => {
  it("returns the setting in the user object", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/auth/me",
      headers: headers(userToken),
    });
    expect(res.json().user.confirmHabitCompletion).toBe(true);
  });

  it("updates the setting", async () => {
    const res = await app.inject({
      method: "PUT", url: "/api/auth/me/habit-confirm",
      headers: headers(userToken),
      payload: { confirmHabitCompletion: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.confirmHabitCompletion).toBe(false);
  });
});

describe("Habits in planning", () => {
  it("planning excludes habits from tasks but returns them in habits", async () => {
    const monday = new Date(2026, 7, 10); // Mon, 2026-08-10
    const sunday = new Date(2026, 7, 16);
    const res = await app.inject({
      method: "GET",
      url: `/api/planning?from=${isoDate(monday)}&to=${isoDate(sunday)}`,
      headers: headers(userToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tasks.some((t: { isHabit: boolean }) => t.isHabit)).toBe(false);
    expect(body.habits.length).toBeGreaterThanOrEqual(1);
    const habit = body.habits.find((h: { title: string }) => h.title === "Wasser trinken");
    expect(habit).toBeDefined();
    expect(typeof habit.completedToday).toBe("boolean");
  });

  it("confirmPlanning ignores habit ids in drafts", async () => {
    const habitRes = await app.inject({
      method: "GET", url: "/api/tasks?isHabit=true&pageSize=1",
      headers: headers(userToken),
    });
    const habit = habitRes.json().items[0];

    await app.inject({
      method: "PUT", url: "/api/planning/draft",
      headers: headers(userToken),
      payload: { changes: { [habit.id]: dateOnlyString(new Date(2026, 7, 11)) } },
    });
    const confirm = await app.inject({
      method: "POST", url: "/api/planning/confirm",
      headers: headers(userToken),
    });
    expect(confirm.statusCode).toBe(200);

    const task = await app.inject({
      method: "GET", url: `/api/tasks/${habit.id}`,
      headers: headers(userToken),
    });
    expect(task.json().plannedDate).toBeNull();
  });
});
