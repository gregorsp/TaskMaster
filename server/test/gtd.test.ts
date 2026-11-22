import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { tasks } from "../src/db/schema.js";
import { reconcileNextSteps } from "../src/modules/tasks/tasks.service.js";
import { DEFAULT_POMODORO_SETTINGS } from "../src/lib/pomodoro.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let ownerToken: string;
let otherToken: string;

async function register(name: string) {
  await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username: name, email: `${name}@test.com`, password: "secret123456", displayName: name },
  });
  const login = await app.inject({
    method: "POST", url: "/api/auth/login", payload: { email: `${name}@test.com`, password: "secret123456" },
  });
  return login.json().accessToken as string;
}

beforeAll(async () => {
  await initDb();
  migrate(getDb(), { migrationsFolder: "./src/db/migrations" });
  app = await buildApp();
  await app.ready();
  ownerToken = await register("gtd_owner");
  otherToken = await register("gtd_other");
});

afterAll(async () => {
  await app.close();
  closeDb();
});

function call(token: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: payload as object });
}

async function createTask(token: string, payload: Record<string, unknown>) {
  const res = await call(token, "POST", "/api/tasks", { isPrivate: true, ...payload });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

describe("Pomodoro-Einstellungen", () => {
  it("liefert Standardwerte und speichert eigene Längen", async () => {
    const me = (await call(ownerToken, "GET", "/api/auth/me")).json();
    expect(me.user.pomodoroSettings).toEqual(DEFAULT_POMODORO_SETTINGS);

    const custom = { workMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 30, longBreakEvery: 3, sound: false };
    const res = await call(ownerToken, "PUT", "/api/auth/me/pomodoro-settings", custom);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.pomodoroSettings).toEqual(custom);
    expect((await call(ownerToken, "GET", "/api/auth/me")).json().user.pomodoroSettings).toEqual(custom);

    // Andere Nutzer behalten ihre eigenen Werte.
    expect((await call(otherToken, "GET", "/api/auth/me")).json().user.pomodoroSettings).toEqual(DEFAULT_POMODORO_SETTINGS);
  });

  it("weist ungültige Längen ab", async () => {
    const res = await call(ownerToken, "PUT", "/api/auth/me/pomodoro-settings", {
      ...DEFAULT_POMODORO_SETTINGS, workMinutes: 0,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Mindmaps", () => {
  it("speichert Boards serverseitig und nur für den Besitzer", async () => {
    const nodes = [{ id: "root", text: "Urlaub", x: 1, y: 2, color: "#1976d2", parentId: null }];
    const created = await call(ownerToken, "POST", "/api/mindmaps", { title: "Urlaub", nodes, extraEdges: [] });
    expect(created.statusCode).toBe(201);
    const board = created.json();

    const updated = await call(ownerToken, "PUT", `/api/mindmaps/${board.id}`, {
      nodes: [...nodes, { id: "n1", text: "Flug buchen", x: 3, y: 4, color: "#000", parentId: "root" }],
    });
    expect(updated.json().nodes).toHaveLength(2);
    expect(updated.json().title).toBe("Urlaub");

    expect((await call(otherToken, "GET", "/api/mindmaps")).json()).toHaveLength(0);
    expect((await call(otherToken, "PUT", `/api/mindmaps/${board.id}`, { title: "x" })).statusCode).toBe(404);

    expect((await call(ownerToken, "DELETE", `/api/mindmaps/${board.id}`)).statusCode).toBe(200);
    expect((await call(ownerToken, "GET", "/api/mindmaps")).json()).toHaveLength(0);
  });
});

describe("Abgleich beim Serverstart", () => {
  it("gibt Altprojekten ohne Nächsten Schritt den ältesten offenen Schritt", async () => {
    const project = await createTask(ownerToken, { title: "Altprojekt" });
    const s1 = await createTask(ownerToken, { title: "Alt 1", parentId: project.id });
    await createTask(ownerToken, { title: "Alt 2", parentId: project.id });
    // Zustand vor der Automatik simulieren.
    getDb().update(tasks).set({ status: null }).where(eq(tasks.parentId, project.id)).run();

    expect(reconcileNextSteps()).toBeGreaterThanOrEqual(1);
    expect((await call(ownerToken, "GET", `/api/tasks/${s1.id}`)).json().status).toBe("next");
    expect(reconcileNextSteps()).toBe(0);
  });
});
