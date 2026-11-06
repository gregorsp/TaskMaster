import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { scrypt, randomBytes } from "node:crypto";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { closeDb, getDb, initDb } from "../src/db/client.js";
import { runMigration } from "../src/db/migrations.js";
import { meditationSessions, taskAssignees, taskEvents, taskOccurrences, tasks, users } from "../src/db/schema.js";
import { resolveRange } from "../src/modules/stats/range.js";

const KEYLEN = 64;
const DAY_MS = 86_400_000;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => (err ? reject(err) : resolve(salt + ":" + k.toString("hex"))));
  });
}

let app: FastifyInstance;
let adminId: string;
let userId: string;
let otherId: string;
let adminToken: string;
let userToken: string;
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
      passwordHash: await hashPassword("stats123", salt),
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
    payload: { email, password: "stats123" },
  });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}

function headers(token: string) {
  return { authorization: `Bearer ${token}` };
}

function utcMidnight(offsetDays: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
}

function utcDateKey(offsetDays: number): string {
  return utcMidnight(offsetDays).toISOString().slice(0, 10);
}

function insertTask(overrides: Partial<typeof tasks.$inferInsert> = {}): string {
  const id = uuid();
  getDb()
    .insert(tasks)
    .values({
      id,
      title: "Aufgabe",
      createdById: userId,
      createdAt: new Date(),
      ...overrides,
    })
    .run();
  return id;
}

function insertEvent(taskId: string, eventUserId: string, createdAt: Date, occurrenceDate?: Date): void {
  getDb()
    .insert(taskEvents)
    .values({ id: uuid(), taskId, userId: eventUserId, type: "completed", createdAt, occurrenceDate })
    .run();
}

function insertOccurrence(taskId: string, occurrenceDate: Date, completedById: string): void {
  getDb()
    .insert(taskOccurrences)
    .values({
      id: uuid(),
      taskId,
      occurrenceDate,
      isCompleted: true,
      completedAt: new Date(),
      completedById,
      createdAt: new Date(),
    })
    .run();
}

function insertSession(
  sessionUserId: string,
  startedAt: Date,
  actualDurationSec: number,
  plannedDurationSec?: number,
  concentration?: number
): void {
  getDb()
    .insert(meditationSessions)
    .values({
      id: uuid(),
      userId: sessionUserId,
      startedAt,
      actualDurationSec,
      plannedDurationSec: plannedDurationSec ?? null,
      concentration: concentration ?? null,
      createdAt: new Date(),
    })
    .run();
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
  adminId = await seedUser("stats_admin", true);
  userId = await seedUser("stats_user", false);
  otherId = await seedUser("stats_other", false);
  adminToken = await login("stats_admin@test.com");
  userToken = await login("stats_user@test.com");
  otherToken = await login("stats_other@test.com");
});

describe("Statistik: Zeitraum", () => {
  it("liefert das 7-Tage-Raster und den gleichen Zeitraum wie die Tagesliste", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/stats/tasks?scope=mine&lens=completed&range=7d&tz=UTC",
      headers: headers(userToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toHaveLength(7);
    expect(body.range.preset).toBe("7d");
    expect(body.range.from).toBe(body.days[0].date);
    expect(body.range.to).toBe(body.days[6].date);
    expect(body.range.compareTo).toBe(utcDateKey(-7));
    expect(body.totals.completed).toBe(0);
  });

  it("akzeptiert einen eigenen Zeitraum und validiert die Grenzen", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/stats/tasks?scope=mine&range=custom&from=${utcDateKey(-2)}&to=${utcDateKey(0)}&tz=UTC`,
      headers: headers(userToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().days).toHaveLength(3);

    const invalid = await app.inject({
      method: "GET",
      url: `/api/stats/tasks?scope=mine&range=custom&from=${utcDateKey(0)}&to=${utcDateKey(-2)}&tz=UTC`,
      headers: headers(userToken),
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: "/api/stats/tasks?scope=mine&range=custom&tz=UTC",
      headers: headers(userToken),
    });
    expect(missing.statusCode).toBe(400);

    const badZone = await app.inject({
      method: "GET",
      url: "/api/stats/tasks?scope=mine&range=7d&tz=Mars/Olympus",
      headers: headers(userToken),
    });
    expect(badZone.statusCode).toBe(400);
  });

  it("rechnet Kalenderwoche und Vorwoche korrekt", () => {
    const week = resolveRange({ range: "week", tz: "UTC" }, new Date("2026-11-06T12:00:00Z"));
    expect(week.dayKeys).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(week.compareFrom).toBe("2026-10-26");
    expect(week.compareTo).toBe("2026-10-30");
    expect(week.compareDayKeys).toHaveLength(5);
  });

  it("bildet das Tagesraster über die Sommerzeitgrenze", () => {
    const range = resolveRange({ range: "7d", tz: "Europe/Berlin" }, new Date("2026-03-30T10:00:00Z"));
    expect(range.dayKeys).toHaveLength(7);
    expect(range.dayKeys[0]).toBe("2026-03-24");
    expect(range.dayKeys[6]).toBe("2026-03-30");
    // Mitternacht am 24. März ist noch CET (+1), am 30. März schon CEST (+2).
    expect(range.start.toISOString()).toBe("2026-03-23T23:00:00.000Z");
    expect(range.end.getTime()).toBe(Date.parse("2026-03-30T10:00:00Z"));
  });
});

describe("Statistik: Aufgaben", () => {
  it("zählt Erledigungen und bewertet die Frist", async () => {
    const onTime = insertTask({ dueAt: new Date(utcMidnight(0).getTime() + 23 * 3_600_000) });
    const late = insertTask({ dueAt: new Date(utcMidnight(-1).getTime() + 12 * 3_600_000) });
    const withoutDue = insertTask();
    const now = new Date();
    insertEvent(onTime, userId, now);
    insertEvent(late, userId, now);
    insertEvent(withoutDue, userId, now);

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/tasks?scope=mine&lens=completed&range=7d&tz=UTC",
      headers: headers(userToken),
    });
    const body = res.json();
    expect(body.totals.completed).toBe(3);
    expect(body.totals.onTime).toBe(1);
    expect(body.totals.late).toBe(1);
    expect(body.totals.withoutDeadline).toBe(1);
    expect(body.totals.onTimeRate).toBeCloseTo(0.5, 5);
    expect(body.previous.completed).toBe(0);
    expect(body.perUser).toBeNull();

    const today = body.days.find((day: { date: string }) => day.date === utcDateKey(0));
    expect(today.completed).toBe(3);
    expect(today.onTime).toBe(1);
    expect(today.late).toBe(1);
  });

  it("zählt im Modus 'erstellt' die im Zeitraum angelegten Aufgaben", async () => {
    insertTask();
    insertTask({ createdAt: new Date(Date.now() - 2 * DAY_MS) });
    insertTask({ createdAt: new Date(Date.now() - 40 * DAY_MS) });

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/tasks?scope=mine&lens=created&range=7d&tz=UTC",
      headers: headers(userToken),
    });
    const body = res.json();
    expect(body.totals.created).toBe(2);
    expect(body.totals.completed).toBe(0);
    expect(body.distributions.tasks).toBe(2);
  });

  it("zeigt im Modus 'zugewiesen' den offenen und überfälligen Bestand", async () => {
    const overdue = insertTask({ dueAt: new Date(utcMidnight(-1).getTime() + 12 * 3_600_000) });
    const withoutDue = insertTask();
    getDb().insert(taskAssignees).values({ taskId: overdue, userId }).run();
    getDb().insert(taskAssignees).values({ taskId: withoutDue, userId }).run();

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/tasks?scope=mine&lens=assigned&range=7d&tz=UTC",
      headers: headers(userToken),
    });
    const body = res.json();
    expect(body.totals.open).toBe(2);
    expect(body.totals.openWithoutDue).toBe(1);
    expect(body.totals.overdue).toBe(1);
    expect(body.distributions.tasks).toBe(2);
  });

  it("berechnet Habit-Quote und Streak gegen die Tage seit Erstellung", async () => {
    const habit = insertTask({
      title: "Sport",
      isHabit: true,
      isPrivate: true,
      createdAt: utcMidnight(-3),
    });
    insertOccurrence(habit, utcMidnight(0), userId);
    insertOccurrence(habit, utcMidnight(-1), userId);
    insertOccurrence(habit, utcMidnight(-2), userId);

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/tasks?scope=mine&lens=completed&range=7d&tz=UTC",
      headers: headers(userToken),
    });
    const body = res.json();
    expect(body.habits.items).toHaveLength(1);
    const item = body.habits.items[0];
    expect(item.title).toBe("Sport");
    expect(item.expectedDays).toBe(4);
    expect(item.completedDays).toBe(3);
    expect(item.rate).toBeCloseTo(0.75, 5);
    expect(item.currentStreak).toBe(3);
    expect(item.bestStreak).toBe(3);
    expect(body.habits.overall.rate).toBeCloseTo(0.75, 5);
    expect(body.habits.perUser).toBeNull();
  });

  it("verweigert die Gesamtansicht ohne Adminrechte", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/stats/tasks?scope=all&lens=completed&range=7d",
      headers: headers(userToken),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("gruppiert für Admins pro Nutzer – auch private Aufgaben", async () => {
    const privateTask = insertTask({ isPrivate: true, createdById: otherId });
    insertEvent(privateTask, otherId, new Date());
    const ownTask = insertTask();
    insertEvent(ownTask, userId, new Date());

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/tasks?scope=all&lens=completed&range=7d&tz=UTC",
      headers: headers(adminToken),
    });
    const body = res.json();
    expect(body.totals.completed).toBe(2);
    expect(body.perUser).toHaveLength(2);
    const names = body.perUser.map((row: { displayName: string }) => row.displayName).sort();
    expect(names).toEqual(["stats_other", "stats_user"]);
    expect(body.habits.perUser).not.toBeNull();
  });
});

describe("Statistik: Meditation", () => {
  it("aggregiert Minuten, Konzentration und Plan-Treue", async () => {
    insertSession(userId, utcMidnight(0), 600, 600, 4);
    insertSession(userId, utcMidnight(-1), 300, 600);

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/meditation?scope=mine&range=7d&tz=UTC",
      headers: headers(userToken),
    });
    const body = res.json();
    expect(body.totals.sessions).toBe(2);
    expect(body.totals.minutes).toBe(15);
    expect(body.totals.plannedMinutes).toBe(20);
    expect(body.totals.adherenceRate).toBeCloseTo(0.75, 5);
    expect(body.totals.avgConcentration).toBe(4);
    expect(body.totals.ratedSessions).toBe(1);
    expect(body.totals.currentStreak).toBe(2);
    expect(body.days).toHaveLength(7);
    expect(body.perUser).toBeNull();
  });

  it("verweigert die Gesamtansicht ohne Adminrechte", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/stats/meditation?scope=all&range=7d",
      headers: headers(otherToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("gruppiert für Admins pro Nutzer", async () => {
    insertSession(userId, utcMidnight(0), 600);
    insertSession(otherId, utcMidnight(0), 300);

    const res = await app.inject({
      method: "GET",
      url: "/api/stats/meditation?scope=all&range=7d&tz=UTC",
      headers: headers(adminToken),
    });
    const body = res.json();
    expect(body.totals.sessions).toBe(2);
    expect(body.perUser).toHaveLength(2);
    expect(body.perUser[0].minutes).toBe(10);
  });
});
