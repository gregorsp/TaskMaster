import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { tasks } from "../src/db/schema.js";
import { reconcileNextSteps } from "../src/modules/tasks/tasks.service.js";
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
  ownerToken = await register("horizon_owner");
  otherToken = await register("horizon_other");
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

describe("Ziele", () => {
  it("CRUD, Verknüpfung mit Aufgaben und Fortschritt", async () => {
    const created = await call(ownerToken, "POST", "/api/goals", { title: "Gesund bleiben", targetDate: "2027-06-30" });
    expect(created.statusCode).toBe(201);
    const goal = created.json();

    const project = await createTask(ownerToken, { title: "Laufplan", goalId: goal.id });
    await createTask(ownerToken, { title: "Schuhe kaufen", parentId: project.id });
    const single = await createTask(ownerToken, { title: "Arzttermin", goalId: goal.id });
    await call(ownerToken, "POST", `/api/tasks/${single.id}/complete`, {});

    const list = (await call(ownerToken, "GET", "/api/goals")).json();
    const entry = list.find((g: { id: string }) => g.id === goal.id);
    expect(entry.openCount).toBe(1);
    expect(entry.doneCount).toBe(1);
    const linkedProject = entry.tasks.find((t: { id: string }) => t.id === project.id);
    expect(linkedProject.isProject).toBe(true);
    expect(linkedProject.nextStep.title).toBe("Schuhe kaufen");

    const achieved = await call(ownerToken, "PUT", `/api/goals/${goal.id}`, { achieved: true });
    expect(achieved.json().achievedAt).toBeTruthy();

    const del = await call(ownerToken, "DELETE", `/api/goals/${goal.id}`);
    expect(del.statusCode).toBe(200);
    expect((await call(ownerToken, "GET", `/api/tasks/${project.id}`)).json().goalId).toBeNull();
  });

  it("mit einem Ziel verknüpfte Aufgaben gelten als organisiert (nicht im Eingangskorb)", async () => {
    const goal = (await call(ownerToken, "POST", "/api/goals", { title: "Ordnung" })).json();
    const linked = await createTask(ownerToken, { title: "Keller entrümpeln", goalId: goal.id });
    const loose = await createTask(ownerToken, { title: "Loser Gedanke" });
    const inbox = (await call(ownerToken, "GET", "/api/tasks?uncategorized=true&pageSize=100")).json().items
      .map((t: { id: string }) => t.id);
    expect(inbox).toContain(loose.id);
    expect(inbox).not.toContain(linked.id);
  });

  it("fremde Ziele sind unsichtbar und nicht verknüpfbar", async () => {
    const foreign = (await call(otherToken, "POST", "/api/goals", { title: "Geheim" })).json();

    expect((await call(ownerToken, "GET", "/api/goals")).json().map((g: { id: string }) => g.id)).not.toContain(foreign.id);
    expect((await call(ownerToken, "PUT", `/api/goals/${foreign.id}`, { title: "x" })).statusCode).toBe(404);
    expect((await call(ownerToken, "DELETE", `/api/goals/${foreign.id}`)).statusCode).toBe(404);

    const res = await call(ownerToken, "POST", "/api/tasks", { title: "Hack", goalId: foreign.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_GOAL");
  });

  it("Weekly Review meldet Ziele ohne offene Aufgabe", async () => {
    const idle = (await call(ownerToken, "POST", "/api/goals", { title: "Spanisch lernen" })).json();
    const active = (await call(ownerToken, "POST", "/api/goals", { title: "Umzug" })).json();
    await createTask(ownerToken, { title: "Kisten packen", goalId: active.id });

    const review = (await call(ownerToken, "GET", "/api/tasks/review")).json();
    const ids = review.idleGoals.map((g: { id: string }) => g.id);
    expect(ids).toContain(idle.id);
    expect(ids).not.toContain(active.id);
  });
});

describe("Zeitblöcke", () => {
  it("legt einen Block für mehrere Tage an, sortiert und prüft Eingaben", async () => {
    const contexts = (await call(ownerToken, "GET", "/api/contexts")).json();
    const res = await call(ownerToken, "POST", "/api/time-blocks", {
      weekdays: ["wed", "mon"], startMinute: 9 * 60, endMinute: 11 * 60,
      title: "Deep Work", contextId: contexts[0].id, energy: "high",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveLength(2);

    const list = (await call(ownerToken, "GET", "/api/time-blocks")).json();
    expect(list.map((b: { weekday: string }) => b.weekday).slice(0, 2)).toEqual(["mon", "wed"]);

    const backwards = await call(ownerToken, "POST", "/api/time-blocks", {
      weekdays: ["mon"], startMinute: 600, endMinute: 540, title: "Falsch",
    });
    expect(backwards.statusCode).toBe(400);

    const foreignCtx = (await call(otherToken, "GET", "/api/contexts")).json()[0];
    const stolen = await call(ownerToken, "POST", "/api/time-blocks", {
      weekdays: ["tue"], startMinute: 60, endMinute: 120, title: "Fremd", contextId: foreignCtx.id,
    });
    expect(stolen.statusCode).toBe(400);

    const block = list[0];
    const moved = await call(ownerToken, "PUT", `/api/time-blocks/${block.id}`, { startMinute: 8 * 60 });
    expect(moved.json().startMinute).toBe(480);
    expect((await call(otherToken, "DELETE", `/api/time-blocks/${block.id}`)).statusCode).toBe(404);
    expect((await call(ownerToken, "DELETE", `/api/time-blocks/${block.id}`)).statusCode).toBe(200);
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
