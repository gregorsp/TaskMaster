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
    scrypt(password, salt, KEYLEN, (err, k) => err ? reject(err) : resolve(salt + ":" + k.toString("hex")));
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
    id: uuid(), username: "admin2", email: "admin2@test.com",
    passwordHash: pw, displayName: "Admin 2", isAdmin: true, createdAt: new Date(),
  }).run();

  app = await buildApp();
  await app.ready();

  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "admin2@test.com", password: "admin123admin" },
  });
  adminToken = login.json().accessToken;

  await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username: "user1", email: "user1@test.com", password: "user123456", displayName: "User 1" },
  });
  const userLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "user1@test.com", password: "user123456" },
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

describe("Tasks CRUD", () => {
  let taskId: string;

  it("creates a task", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(adminToken),
      payload: {
        title: "Test Task",
        description: "A test task",
        isImportant: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe("Test Task");
    expect(body.isImportant).toBe(true);
    taskId = body.id;
  });

  it("lists tasks", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/tasks",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("gets a single task", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/tasks/${taskId}`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Test Task");
  });

  it("updates a task", async () => {
    const res = await app.inject({
      method: "PUT", url: `/api/tasks/${taskId}`,
      headers: headers(adminToken),
      payload: { title: "Updated Task", urgencyMode: "always" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Updated Task");
    expect(res.json().isUrgent).toBe(true);
  });

  it("completes a non-recurring task", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${taskId}/complete`,
      headers: headers(adminToken),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().completed).toBe(true);
  });

  it("reopens a task", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${taskId}/reopen`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("deletes a task", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/api/tasks/${taskId}`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});

describe("Private tasks visibility", () => {
  let privateTaskId: string;

  it("admin creates private task", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(adminToken),
      payload: { title: "Secret Task", isPrivate: true },
    });
    expect(res.statusCode).toBe(201);
    privateTaskId = res.json().id;
  });

  it("creator can see private task", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/tasks/${privateTaskId}`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it("other user cannot see private task", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/tasks/${privateTaskId}`,
      headers: headers(userToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("other user does not see private task in list", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/tasks",
      headers: headers(userToken),
    });
    const body = res.json();
    const found = body.items.find((t: { id: string }) => t.id === privateTaskId);
    expect(found).toBeUndefined();
  });
});

describe("Categories", () => {
  let catId: string;

  it("creates a category with auto color", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/categories",
      headers: headers(adminToken),
      payload: { name: "Work" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Work");
    expect(body.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    catId = body.id;
  });

  it("lists categories", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/categories",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("deletes category", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/api/categories/${catId}`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("Users admin", () => {
  it("lists users (admin only)", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/users",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("non-admin cannot list users", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/users",
      headers: headers(userToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Calendar", () => {
  it("returns empty array for empty range", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/calendar?from=2020-01-01&to=2020-01-31",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});
