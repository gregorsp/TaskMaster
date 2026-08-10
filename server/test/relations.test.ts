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
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const salt = randomBytes(16).toString("hex");
  const pw = await hashPassword("admin123admin", salt);
  db.insert(users).values({
    id: uuid(), username: "reladmin", email: "reladmin@test.com",
    passwordHash: pw, displayName: "Rel Admin", isAdmin: true, createdAt: new Date(),
  }).run();

  app = await buildApp();
  await app.ready();

  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "reladmin@test.com", password: "admin123admin" },
  });
  adminToken = login.json().accessToken;

  await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username: "reluser", email: "reluser@test.com", password: "user123456", displayName: "Rel User" },
  });
  const userLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "reluser@test.com", password: "user123456" },
  });
  userToken = userLogin.json().accessToken;
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
  return res.json().id as string;
}

async function deleteTask(token: string, id: string) {
  const res = await app.inject({ method: "DELETE", url: `/api/tasks/${id}`, headers: headers(token) });
  return res;
}

describe("Subtasks", () => {
  it("creates a task with a parentId", async () => {
    const parent = await createTask(adminToken, { title: "Parent A" });
    const child = await createTask(adminToken, { title: "Child A", parentId: parent });

    const res = await app.inject({ method: "GET", url: `/api/tasks/${child}`, headers: headers(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().parentId).toBe(parent);

    await deleteTask(adminToken, child);
    await deleteTask(adminToken, parent);
  });

  it("rejects a nonexistent parent", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(adminToken),
      payload: { title: "Bad Parent", parentId: "does-not-exist" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PARENT_NOT_FOUND");
  });

  it("rejects invisible parent for non-admin", async () => {
    const privateTask = await createTask(adminToken, { title: "Private Parent", isPrivate: true });
    const res = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(userToken),
      payload: { title: "Child Of Hidden", parentId: privateTask },
    });
    expect(res.statusCode).toBe(404);
    await deleteTask(adminToken, privateTask);
  });

  it("detaches a subtask via parentId null", async () => {
    const parent = await createTask(adminToken, { title: "Parent B" });
    const child = await createTask(adminToken, { title: "Child B", parentId: parent });

    const upd = await app.inject({
      method: "PUT", url: `/api/tasks/${child}`,
      headers: headers(adminToken),
      payload: { parentId: null },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().parentId).toBeNull();

    await deleteTask(adminToken, child);
    await deleteTask(adminToken, parent);
  });

  it("rejects setting self as parent", async () => {
    const t = await createTask(adminToken, { title: "Self Parent" });
    const res = await app.inject({
      method: "PUT", url: `/api/tasks/${t}`,
      headers: headers(adminToken),
      payload: { parentId: t },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_PARENT");
    await deleteTask(adminToken, t);
  });

  it("rejects setting a descendant as parent (cycle)", async () => {
    const root = await createTask(adminToken, { title: "Root" });
    const child = await createTask(adminToken, { title: "Child", parentId: root });
    const grandchild = await createTask(adminToken, { title: "Grandchild", parentId: child });

    const res = await app.inject({
      method: "PUT", url: `/api/tasks/${root}`,
      headers: headers(adminToken),
      payload: { parentId: grandchild },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CYCLE_DETECTED");

    await deleteTask(adminToken, grandchild);
    await deleteTask(adminToken, child);
    await deleteTask(adminToken, root);
  });

  it("blocks deletion when subtasks exist", async () => {
    const parent = await createTask(adminToken, { title: "Parent C" });
    await createTask(adminToken, { title: "Child C", parentId: parent });

    const res = await deleteTask(adminToken, parent);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("HAS_SUBTASKS");

    // cleanup: list subtasks and delete them
    const subs = await app.inject({ method: "GET", url: `/api/tasks/${parent}/subtasks`, headers: headers(adminToken) });
    for (const s of subs.json().subtasks) {
      await deleteTask(adminToken, s.id);
    }
    await deleteTask(adminToken, parent);
  });

  it("lists subtasks with progress", async () => {
    const parent = await createTask(adminToken, { title: "Parent D" });
    const c1 = await createTask(adminToken, { title: "Child D1", parentId: parent });
    const c2 = await createTask(adminToken, { title: "Child D2", parentId: parent });

    const res = await app.inject({ method: "GET", url: `/api/tasks/${parent}/subtasks`, headers: headers(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().progress).toEqual({ completed: 0, total: 2 });
    expect(res.json().subtasks).toHaveLength(2);

    await app.inject({ method: "POST", url: `/api/tasks/${c1}/complete`, headers: headers(adminToken), payload: {} });
    const res2 = await app.inject({ method: "GET", url: `/api/tasks/${parent}/subtasks`, headers: headers(adminToken) });
    expect(res2.json().progress).toEqual({ completed: 1, total: 2 });

    await deleteTask(adminToken, c1);
    await deleteTask(adminToken, c2);
    await deleteTask(adminToken, parent);
  });

  it("reports subtaskCount for tasks that have their own subtasks", async () => {
    const parent = await createTask(adminToken, { title: "Parent H" });
    const child = await createTask(adminToken, { title: "Child H", parentId: parent });
    await createTask(adminToken, { title: "Grandchild H", parentId: child });

    const res = await app.inject({ method: "GET", url: `/api/tasks/${parent}/subtasks`, headers: headers(adminToken) });
    expect(res.statusCode).toBe(200);
    const childRow = (res.json().subtasks as { id: string; subtaskCount: number }[]).find((s) => s.id === child);
    expect(childRow?.subtaskCount).toBe(1);

    const subs = await app.inject({ method: "GET", url: `/api/tasks/${child}/subtasks`, headers: headers(adminToken) });
    const grandchild = subs.json().subtasks[0] as { id: string; subtaskCount: number };
    expect(grandchild.subtaskCount).toBe(0);

    await deleteTask(adminToken, grandchild.id);
    await deleteTask(adminToken, child);
    await deleteTask(adminToken, parent);
  });

  it("returns ancestors, current, descendants and links per task", async () => {
    const root = await createTask(adminToken, { title: "Root R" });
    const child = await createTask(adminToken, { title: "Child R", parentId: root });
    const grandchild = await createTask(adminToken, { title: "Grandchild R", parentId: child });
    await app.inject({
      method: "POST", url: `/api/tasks/${child}/links`,
      headers: headers(adminToken),
      payload: { linkedTaskId: grandchild },
    });

    const resChild = await app.inject({ method: "GET", url: `/api/tasks/${child}/relations`, headers: headers(adminToken) });
    expect(resChild.statusCode).toBe(200);
    const body = resChild.json();
    expect(body.ancestors.map((t: { id: string }) => t.id)).toEqual([root]);
    expect(body.current.id).toBe(child);
    expect(body.current.parentId).toBe(root);
    expect(body.descendants.map((t: { id: string }) => t.id)).toEqual([grandchild]);
    expect(body.descendants[0].parentId).toBe(child);
    expect(body.links[child].map((t: { id: string }) => t.id)).toContain(grandchild);

    const resRoot = await app.inject({ method: "GET", url: `/api/tasks/${root}/relations`, headers: headers(adminToken) });
    const rootBody = resRoot.json();
    expect(rootBody.ancestors).toHaveLength(0);
    expect(rootBody.descendants.map((t: { id: string }) => t.id)).toEqual([child, grandchild]);

    await deleteTask(adminToken, grandchild);
    await deleteTask(adminToken, child);
    await deleteTask(adminToken, root);
  });
});

describe("Completion gating", () => {
  it("blocks completing a parent with open subtasks", async () => {
    const parent = await createTask(adminToken, { title: "Parent E" });
    await createTask(adminToken, { title: "Child E", parentId: parent });

    const res = await app.inject({
      method: "POST", url: `/api/tasks/${parent}/complete`,
      headers: headers(adminToken),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SUBTASKS_OPEN");

    const subs = await app.inject({ method: "GET", url: `/api/tasks/${parent}/subtasks`, headers: headers(adminToken) });
    for (const s of subs.json().subtasks) {
      await deleteTask(adminToken, s.id);
    }
    await deleteTask(adminToken, parent);
  });

  it("completes parent when all subtasks are done", async () => {
    const parent = await createTask(adminToken, { title: "Parent F" });
    const child = await createTask(adminToken, { title: "Child F", parentId: parent });

    await app.inject({ method: "POST", url: `/api/tasks/${child}/complete`, headers: headers(adminToken), payload: {} });
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${parent}/complete`,
      headers: headers(adminToken),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().completed).toBe(true);

    await deleteTask(adminToken, child);
    await deleteTask(adminToken, parent);
  });

  it("force-completes open subtasks with forceCompleteSubtasks", async () => {
    const parent = await createTask(adminToken, { title: "Parent G" });
    const child = await createTask(adminToken, { title: "Child G", parentId: parent });

    const res = await app.inject({
      method: "POST", url: `/api/tasks/${parent}/complete`,
      headers: headers(adminToken),
      payload: { forceCompleteSubtasks: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().completed).toBe(true);

    const subs = await app.inject({ method: "GET", url: `/api/tasks/${parent}/subtasks`, headers: headers(adminToken) });
    expect(subs.json().progress).toEqual({ completed: 1, total: 1 });

    await deleteTask(adminToken, child);
    await deleteTask(adminToken, parent);
  });
});

describe("Task links", () => {
  it("creates and lists symmetric links", async () => {
    const a = await createTask(adminToken, { title: "Link A" });
    const b = await createTask(adminToken, { title: "Link B" });

    const add = await app.inject({
      method: "POST", url: `/api/tasks/${a}/links`,
      headers: headers(adminToken),
      payload: { linkedTaskId: b },
    });
    expect(add.statusCode).toBe(201);

    const linksA = await app.inject({ method: "GET", url: `/api/tasks/${a}/links`, headers: headers(adminToken) });
    const linksB = await app.inject({ method: "GET", url: `/api/tasks/${b}/links`, headers: headers(adminToken) });
    expect(linksA.json().map((l: { id: string }) => l.id)).toContain(b);
    expect(linksB.json().map((l: { id: string }) => l.id)).toContain(a);

    await deleteTask(adminToken, a);
    await deleteTask(adminToken, b);
  });

  it("rejects linking to itself", async () => {
    const a = await createTask(adminToken, { title: "Self Link" });
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${a}/links`,
      headers: headers(adminToken),
      payload: { linkedTaskId: a },
    });
    expect(res.statusCode).toBe(400);
    await deleteTask(adminToken, a);
  });

  it("removes a link in both directions", async () => {
    const a = await createTask(adminToken, { title: "Link C" });
    const b = await createTask(adminToken, { title: "Link D" });
    await app.inject({
      method: "POST", url: `/api/tasks/${a}/links`,
      headers: headers(adminToken),
      payload: { linkedTaskId: b },
    });

    const del = await app.inject({ method: "DELETE", url: `/api/tasks/${a}/links/${b}`, headers: headers(adminToken) });
    expect(del.statusCode).toBe(200);

    const linksA = await app.inject({ method: "GET", url: `/api/tasks/${a}/links`, headers: headers(adminToken) });
    const linksB = await app.inject({ method: "GET", url: `/api/tasks/${b}/links`, headers: headers(adminToken) });
    expect(linksA.json()).toHaveLength(0);
    expect(linksB.json()).toHaveLength(0);

    await deleteTask(adminToken, a);
    await deleteTask(adminToken, b);
  });

  it("does not expose private linked tasks to non-admins", async () => {
    const pub = await createTask(adminToken, { title: "Public Task" });
    const priv = await createTask(adminToken, { title: "Private Linked", isPrivate: true });
    await app.inject({
      method: "POST", url: `/api/tasks/${pub}/links`,
      headers: headers(adminToken),
      payload: { linkedTaskId: priv },
    });

    const links = await app.inject({ method: "GET", url: `/api/tasks/${pub}/links`, headers: headers(userToken) });
    expect(links.statusCode).toBe(200);
    const ids = (links.json() as { id: string }[]).map((l) => l.id);
    expect(ids).not.toContain(priv);

    await deleteTask(adminToken, pub);
    await deleteTask(adminToken, priv);
  });

  it("bulk links endpoint excludes invisible pairs for non-admins", async () => {
    const pub = await createTask(adminToken, { title: "Bulk Public" });
    const priv = await createTask(adminToken, { title: "Bulk Private", isPrivate: true });
    await app.inject({
      method: "POST", url: `/api/tasks/${pub}/links`,
      headers: headers(adminToken),
      payload: { linkedTaskId: priv },
    });

    const all = await app.inject({ method: "GET", url: "/api/tasks/links", headers: headers(userToken) });
    expect(all.statusCode).toBe(200);
    const pairs = all.json() as { a: string; b: string }[];
    const hasPrivate = pairs.some((p) => p.a === priv || p.b === priv);
    expect(hasPrivate).toBe(false);

    await deleteTask(adminToken, pub);
    await deleteTask(adminToken, priv);
  });
});
