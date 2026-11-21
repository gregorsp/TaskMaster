import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { v7 as uuid } from "uuid";
import { scrypt, randomBytes } from "node:crypto";
import { users, tasks } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => err ? reject(err) : resolve(salt + ":" + k.toString("hex")));
  });
}

let app: FastifyInstance;
let adminToken: string;
let ownerToken: string;
let otherToken: string;
let ownerId: string;
let otherId: string;

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const salt = randomBytes(16).toString("hex");
  const pw = await hashPassword("admin123admin", salt);
  db.insert(users).values({
    id: uuid(), username: "priv_admin", email: "priv_admin@test.com",
    passwordHash: pw, displayName: "Admin", isAdmin: true, createdAt: new Date(),
  }).run();

  app = await buildApp();
  await app.ready();

  const adminLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "priv_admin@test.com", password: "admin123admin" },
  });
  adminToken = adminLogin.json().accessToken;

  const ownerReg = await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username: "priv_owner", email: "priv_owner@test.com", password: "owner123456", displayName: "Owner" },
  });
  ownerId = ownerReg.json().user.id;
  const ownerLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "priv_owner@test.com", password: "owner123456" },
  });
  ownerToken = ownerLogin.json().accessToken;

  const otherReg = await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username: "priv_other", email: "priv_other@test.com", password: "other123456", displayName: "Other" },
  });
  otherId = otherReg.json().user.id;
  const otherLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "priv_other@test.com", password: "other123456" },
  });
  otherToken = otherLogin.json().accessToken;
});

afterAll(async () => {
  await app.close();
  closeDb();
});

function headers(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createTask(token: string, payload: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/api/tasks", headers: headers(token), payload });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; isPrivate: boolean; title: string };
}

async function setPrivacyRow(taskId: string, isPrivate: boolean) {
  getDb().update(tasks).set({ isPrivate }).where(eq(tasks.id, taskId)).run();
}

describe("Standard-Privat", () => {
  it("legt neue Aufgaben ohne isPrivate privat an", async () => {
    const task = await createTask(ownerToken, { title: "Standard privat" });
    expect(task.isPrivate).toBe(true);

    const otherRead = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers(otherToken) });
    expect(otherRead.statusCode).toBe(404);

    const ownerRead = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers(ownerToken) });
    expect(ownerRead.statusCode).toBe(200);
  });

  it("respektiert die Nutzer-Voreinstellung defaultPrivate=false", async () => {
    const off = await app.inject({
      method: "PUT", url: "/api/auth/me/default-private",
      headers: headers(otherToken), payload: { defaultPrivate: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().user.defaultPrivate).toBe(false);

    const task = await createTask(otherToken, { title: "Ohne Voreinstellung" });
    expect(task.isPrivate).toBe(false);

    const ownerRead = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers(ownerToken) });
    expect(ownerRead.statusCode).toBe(200);

    await app.inject({
      method: "PUT", url: "/api/auth/me/default-private",
      headers: headers(otherToken), payload: { defaultPrivate: true },
    });
  });

  it("Unteraufgaben erben die Privatheit der Elternaufgabe", async () => {
    const parent = await createTask(ownerToken, { title: "Privates Projekt" });
    const child = await createTask(ownerToken, {
      title: "Kind", parentId: parent.id, isPrivate: false,
    });
    expect(child.isPrivate).toBe(true);

    const otherRead = await app.inject({ method: "GET", url: `/api/tasks/${child.id}`, headers: headers(otherToken) });
    expect(otherRead.statusCode).toBe(404);
  });

  it("eine Privatheitsänderung zieht alle Unteraufgaben mit", async () => {
    const parent = await createTask(ownerToken, { title: "Wird öffentlich", isPrivate: true });
    const child = await createTask(ownerToken, { title: "Kind folgt", parentId: parent.id });
    const grandchild = await createTask(ownerToken, { title: "Enkel folgt", parentId: child.id });

    const res = await app.inject({
      method: "PUT", url: `/api/tasks/${parent.id}`,
      headers: headers(ownerToken), payload: { isPrivate: false },
    });
    expect(res.statusCode).toBe(200);

    for (const id of [child.id, grandchild.id]) {
      const row = getDb().select({ isPrivate: tasks.isPrivate }).from(tasks).where(eq(tasks.id, id)).get();
      expect(row?.isPrivate).toBe(false);
    }
  });
});

describe("Beziehungs-Endpunkte respektieren Sichtbarkeit", () => {
  it("verknüpfte private Aufgaben erscheinen nicht in der Link-Liste", async () => {
    const publicTask = await createTask(ownerToken, { title: "Öffentlich verknüpft", isPrivate: false });
    const priv = await createTask(ownerToken, { title: "Geheim verknüpft", isPrivate: true });

    const link = await app.inject({
      method: "POST", url: `/api/tasks/${publicTask.id}/links`,
      headers: headers(ownerToken), payload: { linkedTaskId: priv.id },
    });
    expect(link.statusCode).toBe(200);

    const otherView = await app.inject({
      method: "GET", url: `/api/tasks/${publicTask.id}/links`, headers: headers(otherToken),
    });
    expect(otherView.statusCode).toBe(200);
    expect(otherView.json()).toHaveLength(0);

    const ownerView = await app.inject({
      method: "GET", url: `/api/tasks/${publicTask.id}/links`, headers: headers(ownerToken),
    });
    expect(ownerView.json()).toHaveLength(1);
  });

  it("Unteraufgaben und Geschwister werden gefiltert", async () => {
    const parent = await createTask(ownerToken, { title: "Öffentliche Elternaufgabe", isPrivate: false });
    const visible = await createTask(ownerToken, { title: "Sichtbares Kind", parentId: parent.id });
    const hidden = await createTask(ownerToken, { title: "Verstecktes Kind", parentId: parent.id });
    // Altbestand simulieren: Kind ist privater als die Elternaufgabe.
    await setPrivacyRow(hidden.id, true);

    const otherSubtasks = await app.inject({
      method: "GET", url: `/api/tasks/${parent.id}/subtasks`, headers: headers(otherToken),
    });
    expect(otherSubtasks.statusCode).toBe(200);
    const titles = otherSubtasks.json().subtasks.map((t: { title: string }) => t.title);
    expect(titles).toContain("Sichtbares Kind");
    expect(titles).not.toContain("Verstecktes Kind");

    const otherSiblings = await app.inject({
      method: "GET", url: `/api/tasks/${visible.id}/siblings`, headers: headers(otherToken),
    });
    expect(otherSiblings.statusCode).toBe(200);
    expect(otherSiblings.json()).toHaveLength(0);
  });
});

describe("Schreibrechte bei privaten Aufgaben", () => {
  it("nur der Ersteller darf die Privatheit ändern", async () => {
    const task = await createTask(ownerToken, {
      title: "Geteilte private Aufgabe", isPrivate: true, assigneeIds: [otherId],
    });

    const assignedRead = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers(otherToken) });
    expect(assignedRead.statusCode).toBe(200);

    const forbidden = await app.inject({
      method: "PUT", url: `/api/tasks/${task.id}`,
      headers: headers(otherToken), payload: { isPrivate: false },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("FORBIDDEN");

    const row = getDb().select({ isPrivate: tasks.isPrivate }).from(tasks).where(eq(tasks.id, task.id)).get();
    expect(row?.isPrivate).toBe(true);
  });

  it("nur der Ersteller darf Assignees ändern und löschen", async () => {
    const task = await createTask(ownerToken, {
      title: "Nicht löschbar", isPrivate: true, assigneeIds: [otherId],
    });

    const assignees = await app.inject({
      method: "PUT", url: `/api/tasks/${task.id}`,
      headers: headers(otherToken), payload: { assigneeIds: [] },
    });
    expect(assignees.statusCode).toBe(403);

    const deletion = await app.inject({
      method: "DELETE", url: `/api/tasks/${task.id}`, headers: headers(otherToken),
    });
    expect(deletion.statusCode).toBe(403);

    const ownerDeletion = await app.inject({
      method: "DELETE", url: `/api/tasks/${task.id}`, headers: headers(ownerToken),
    });
    expect(ownerDeletion.statusCode).toBe(200);
  });
});

describe("Weitere Lecks", () => {
  it("Occurrence-Delete ist an die Aufgabe gebunden", async () => {
    const recurring = await createTask(ownerToken, {
      title: "Wiederkehrend", isPrivate: false, recurrenceType: "rrule",
      recurrenceRule: "FREQ=DAILY", dueAt: "2026-01-01T00:00:00.000Z",
    });
    const occRes = await app.inject({
      method: "POST", url: `/api/tasks/${recurring.id}/occurrences`,
      headers: headers(ownerToken), payload: { occurrenceDate: "2026-01-02T00:00:00.000Z" },
    });
    expect(occRes.statusCode).toBe(201);
    const occurrenceId = occRes.json().id;

    const foreignTask = await createTask(otherToken, { title: "Fremde Aufgabe", isPrivate: false });
    const attack = await app.inject({
      method: "DELETE", url: `/api/tasks/${foreignTask.id}/occurrences/${occurrenceId}`,
      headers: headers(otherToken),
    });
    expect(attack.statusCode).toBe(200);

    const stillThere = await app.inject({
      method: "GET", url: `/api/tasks/${recurring.id}/occurrences`, headers: headers(ownerToken),
    });
    expect(stillThere.json()).toHaveLength(1);
  });

  it("parentId akzeptiert keine unsichtbaren oder zyklischen Eltern", async () => {
    const invisibleParent = await createTask(ownerToken, { title: "Unsichtbare Elternaufgabe", isPrivate: true });

    const attachForeign = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(otherToken),
      payload: { title: "Anhängen verboten", parentId: invisibleParent.id },
    });
    expect(attachForeign.statusCode).toBe(404);

    const parent = await createTask(ownerToken, { title: "Zyklus-Eltern", isPrivate: false });
    const child = await createTask(ownerToken, { title: "Zyklus-Kind", parentId: parent.id, isPrivate: false });
    const cycle = await app.inject({
      method: "PUT", url: `/api/tasks/${parent.id}`,
      headers: headers(ownerToken), payload: { parentId: child.id },
    });
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json().error.code).toBe("INVALID_PARENT");
  });

  it("Admins haben keinen Sonderzugriff auf private Aufgaben", async () => {
    const priv = await createTask(ownerToken, { title: "Admin liest nicht", isPrivate: true });

    const direct = await app.inject({ method: "GET", url: `/api/tasks/${priv.id}`, headers: headers(adminToken) });
    expect(direct.statusCode).toBe(404);

    const list = await app.inject({ method: "GET", url: "/api/tasks?pageSize=200", headers: headers(adminToken) });
    expect(list.json().items.map((t: { id: string }) => t.id)).not.toContain(priv.id);

    const update = await app.inject({
      method: "PUT", url: `/api/tasks/${priv.id}`, headers: headers(adminToken), payload: { title: "Übernommen" },
    });
    expect(update.statusCode).toBe(404);

    const links = await app.inject({ method: "POST", url: `/api/tasks/${priv.id}/links`, headers: headers(adminToken), payload: { linkedTaskId: priv.id } });
    expect(links.statusCode).toBe(404);
  });

  it("Habits bleiben auch für Admins unsichtbar", async () => {
    const habit = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(ownerToken),
      payload: { title: "Privater Habit", isHabit: true },
    });
    expect(habit.statusCode).toBe(201);
    expect(habit.json().isPrivate).toBe(true);

    const adminRead = await app.inject({ method: "GET", url: `/api/tasks/${habit.json().id}`, headers: headers(adminToken) });
    expect(adminRead.statusCode).toBe(404);

    const daily = await app.inject({ method: "GET", url: "/api/daily", headers: headers(adminToken) });
    expect(daily.statusCode).toBe(200);
    const titles = daily.json().habits.map((h: { title: string }) => h.title);
    expect(titles).not.toContain("Privater Habit");
  });
});
