import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let ownerToken: string;
let otherToken: string;
let ownerId: string;

beforeAll(async () => {
  await initDb();
  migrate(getDb(), { migrationsFolder: "./src/db/migrations" });

  app = await buildApp();
  await app.ready();

  const ownerReg = await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username: "org_owner", email: "org_owner@test.com", password: "owner123456", displayName: "Owner" },
  });
  ownerId = ownerReg.json().user.id;
  const ownerLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "org_owner@test.com", password: "owner123456" },
  });
  ownerToken = ownerLogin.json().accessToken;

  await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username: "org_other", email: "org_other@test.com", password: "other123456", displayName: "Other" },
  });
  const otherLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "org_other@test.com", password: "other123456" },
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

async function createCategory(token: string, name: string) {
  const res = await app.inject({ method: "POST", url: "/api/categories", headers: headers(token), payload: { name } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; name: string; color: string; createdById: string };
}

async function createTask(token: string, payload: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/api/tasks", headers: headers(token), payload });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; isPrivate: boolean };
}

describe("Kategorien pro Nutzer", () => {
  it("listet nur eigene Kategorien", async () => {
    const ownerCat = await createCategory(ownerToken, "Eigene Kategorie");
    const otherCat = await createCategory(otherToken, "Fremde Kategorie");

    const ownerList = await app.inject({ method: "GET", url: "/api/categories", headers: headers(ownerToken) });
    const ids = ownerList.json().map((c: { id: string }) => c.id);
    expect(ids).toContain(ownerCat.id);
    expect(ids).not.toContain(otherCat.id);
  });

  it("verhindert doppelte Namen pro Nutzer", async () => {
    await createCategory(ownerToken, "Uni");
    const duplicate = await app.inject({
      method: "POST", url: "/api/categories", headers: headers(ownerToken), payload: { name: " uni " },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("DUPLICATE_CATEGORY");
  });

  it("fremde Kategorien dürfen nicht geändert oder gelöscht werden", async () => {
    const foreign = await createCategory(otherToken, "Nicht anfassen");

    const update = await app.inject({
      method: "PUT", url: `/api/categories/${foreign.id}`, headers: headers(ownerToken), payload: { name: "Gekapert" },
    });
    expect(update.statusCode).toBe(403);

    const remove = await app.inject({
      method: "DELETE", url: `/api/categories/${foreign.id}`, headers: headers(ownerToken),
    });
    expect(remove.statusCode).toBe(403);
  });

  it("gruppiert gleichnamige Kategorien im Filter", async () => {
    const ownerCat = await createCategory(ownerToken, "Gemeinsam");
    const otherCat = await createCategory(otherToken, "gemeinsam");
    const task = await createTask(ownerToken, {
      title: "Geteilte Aufgabe", isPrivate: false, categoryIds: [ownerCat.id],
    });

    const otherFilter = await app.inject({
      method: "GET", url: `/api/tasks?categoryId=${otherCat.id}`, headers: headers(otherToken),
    });
    expect(otherFilter.statusCode).toBe(200);
    expect(otherFilter.json().items.map((t: { id: string }) => t.id)).toContain(task.id);
  });

  it("liefert Kategorien samt Besitzer an der Aufgabe", async () => {
    const cat = await createCategory(ownerToken, "Mit Besitzer");
    const task = await createTask(ownerToken, { title: "Payload", isPrivate: true, categoryIds: [cat.id] });

    const res = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers(ownerToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().categories[0]).toMatchObject({ id: cat.id, name: "Mit Besitzer", createdById: ownerId });
  });
});

describe("Kontexte", () => {
  it("legt die sechs Standard-Kontexte bei der Registrierung an", async () => {
    const res = await app.inject({ method: "GET", url: "/api/contexts", headers: headers(ownerToken) });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(["Besorgungen", "Computer", "Online", "Telefon", "Uni", "Zuhause"].sort());
  });

  it("verhindert doppelte Namen und fremde Änderungen", async () => {
    const duplicate = await app.inject({
      method: "POST", url: "/api/contexts", headers: headers(ownerToken), payload: { name: "Telefon" },
    });
    expect(duplicate.statusCode).toBe(409);

    const otherList = await app.inject({ method: "GET", url: "/api/contexts", headers: headers(otherToken) });
    const foreignId = otherList.json()[0].id;
    const update = await app.inject({
      method: "PUT", url: `/api/contexts/${foreignId}`, headers: headers(ownerToken), payload: { name: "Fremd" },
    });
    expect(update.statusCode).toBe(403);
  });

  it("hängt Kontexte an Aufgaben und filtert nach Namen", async () => {
    const ownerContexts = await app.inject({ method: "GET", url: "/api/contexts", headers: headers(ownerToken) });
    const telefon = ownerContexts.json().find((c: { name: string }) => c.name === "Telefon");
    const otherContexts = await app.inject({ method: "GET", url: "/api/contexts", headers: headers(otherToken) });
    const otherTelefon = otherContexts.json().find((c: { name: string }) => c.name === "Telefon");

    const task = await createTask(ownerToken, {
      title: "Anruf", isPrivate: false, contextIds: [telefon.id],
    });

    const detail = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers(ownerToken) });
    expect(detail.json().contexts).toHaveLength(1);
    expect(detail.json().contexts[0].name).toBe("Telefon");

    const filtered = await app.inject({
      method: "GET", url: `/api/tasks?contextId=${otherTelefon.id}`, headers: headers(otherToken),
    });
    expect(filtered.json().items.map((t: { id: string }) => t.id)).toContain(task.id);
  });

  it("Löschen eines Kontexts entfernt die Zuordnung", async () => {
    const contexts = await app.inject({ method: "GET", url: "/api/contexts", headers: headers(ownerToken) });
    const custom = await app.inject({
      method: "POST", url: "/api/contexts", headers: headers(ownerToken), payload: { name: "Temp" },
    });
    expect(custom.statusCode).toBe(201);
    const task = await createTask(ownerToken, { title: "Mit Temp", isPrivate: true, contextIds: [custom.json().id] });

    const remove = await app.inject({
      method: "DELETE", url: `/api/contexts/${custom.json().id}`, headers: headers(ownerToken),
    });
    expect(remove.statusCode).toBe(200);

    const detail = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers(ownerToken) });
    expect(detail.json().contexts).toHaveLength(0);
    expect(contexts.json().length).toBeGreaterThanOrEqual(6);
  });
});

describe("Status, Dauer und Energie", () => {
  it("speichert die Felder und filtert danach", async () => {
    const task = await createTask(ownerToken, {
      title: "Wartet", isPrivate: true, status: "waiting", duration: "15_min", energy: "high",
    });

    const detail = await app.inject({ method: "GET", url: `/api/tasks/${task.id}`, headers: headers(ownerToken) });
    expect(detail.json()).toMatchObject({ status: "waiting", duration: "15_min", energy: "high" });

    const waiting = await app.inject({
      method: "GET", url: "/api/tasks?status=waiting&pageSize=200", headers: headers(ownerToken),
    });
    expect(waiting.json().items.map((t: { id: string }) => t.id)).toContain(task.id);

    const high = await app.inject({
      method: "GET", url: "/api/tasks?energy=high&pageSize=200", headers: headers(ownerToken),
    });
    expect(high.json().items.map((t: { id: string }) => t.id)).toContain(task.id);

    const clear = await app.inject({
      method: "PUT", url: `/api/tasks/${task.id}`, headers: headers(ownerToken),
      payload: { status: null, duration: null, energy: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toMatchObject({ status: null, duration: null, energy: null });
  });

  it("Eingangskorb = ohne Kategorie UND ohne Status", async () => {
    const inbox = await createTask(ownerToken, { title: "Eingang", isPrivate: true });
    const sorted = await createTask(ownerToken, {
      title: "Schon einsortiert", isPrivate: true, status: "next",
    });

    const res = await app.inject({
      method: "GET", url: "/api/tasks?uncategorized=true&pageSize=200", headers: headers(ownerToken),
    });
    const ids = res.json().items.map((t: { id: string }) => t.id);
    expect(ids).toContain(inbox.id);
    expect(ids).not.toContain(sorted.id);
  });

  it("Projekte sind Aufgaben mit Unteraufgaben", async () => {
    const project = await createTask(ownerToken, { title: "Projekt", isPrivate: true });
    await createTask(ownerToken, { title: "Schritt", isPrivate: true, parentId: project.id });

    const res = await app.inject({
      method: "GET", url: "/api/tasks?isProject=true&pageSize=200", headers: headers(ownerToken),
    });
    const ids = res.json().items.map((t: { id: string }) => t.id);
    expect(ids).toContain(project.id);

    const detail = await app.inject({ method: "GET", url: `/api/tasks/${project.id}`, headers: headers(ownerToken) });
    expect(detail.json().isProject).toBe(true);
  });
});

describe("KI-Schlüssel", () => {
  it("speichert den Schlüssel verschlüsselt und gibt ihn nie zurück", async () => {
    const res = await app.inject({
      method: "PUT", url: "/api/auth/me/ai-key",
      headers: headers(ownerToken),
      payload: { provider: "deepseek", key: "sk-test-1234567890" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.hasAiKey).toBe(true);
    expect(res.json().user.aiProvider).toBe("deepseek");
    expect(JSON.stringify(res.json())).not.toContain("sk-test-1234567890");

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: headers(ownerToken) });
    expect(me.json().user.hasAiKey).toBe(true);
    expect(JSON.stringify(me.json())).not.toContain("sk-test-1234567890");

    const cleared = await app.inject({
      method: "DELETE", url: "/api/auth/me/ai-key", headers: headers(ownerToken),
    });
    expect(cleared.json().user.hasAiKey).toBe(false);
  });
});
