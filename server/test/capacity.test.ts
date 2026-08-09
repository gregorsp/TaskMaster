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

const VALID = { mon: 5, tue: 3, wed: 0, thu: 4, fri: 4, sat: 0, sun: 0 };

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const salt = randomBytes(16).toString("hex");
  const pw = await hashPassword("admin123admin", salt);
  db.insert(users).values({
    id: uuid(), username: "capadmin", email: "capadmin@test.com",
    passwordHash: pw, displayName: "Cap Admin", isAdmin: true, createdAt: new Date(),
  }).run();

  app = await buildApp();
  await app.ready();

  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "capadmin@test.com", password: "admin123admin" },
  });
  adminToken = login.json().accessToken;

  await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username: "capuser", email: "capuser@test.com", password: "user123456", displayName: "Cap User" },
  });
  const userLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "capuser@test.com", password: "user123456" },
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

describe("Capacity – self service", () => {
  it("returns null for a new user", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/me/capacity", headers: headers(userToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().capacity).toBeNull();
  });

  it("sets capacity and returns it", async () => {
    const res = await app.inject({
      method: "PUT", url: "/api/auth/me/capacity",
      headers: headers(userToken),
      payload: { capacity: VALID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().capacity).toEqual(VALID);

    const get = await app.inject({ method: "GET", url: "/api/auth/me/capacity", headers: headers(userToken) });
    expect(get.json().capacity).toEqual(VALID);
  });

  it("clears capacity with null", async () => {
    const res = await app.inject({
      method: "PUT", url: "/api/auth/me/capacity",
      headers: headers(userToken),
      payload: { capacity: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().capacity).toBeNull();

    const get = await app.inject({ method: "GET", url: "/api/auth/me/capacity", headers: headers(userToken) });
    expect(get.json().capacity).toBeNull();
  });

  it("rejects invalid capacity payloads", async () => {
    const invalid = [
      { capacity: { mon: 5, tue: 3 } },               // fehlende Keys
      { capacity: { ...VALID, mon: -1 } },            // negativ
      { capacity: { ...VALID, mon: 100 } },           // >99
      { capacity: { ...VALID, mon: 2.5 } },           // float
      { capacity: { ...VALID, mon: "5" } },           // string statt number
      { capacity: [] },                               // Array
    ];
    for (const payload of invalid) {
      const res = await app.inject({
        method: "PUT", url: "/api/auth/me/capacity",
        headers: headers(userToken),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe("Capacity – in user responses", () => {
  it("GET /api/auth/me includes capacity", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: headers(userToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toHaveProperty("capacity");
  });

  it("login response includes capacity", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/auth/login",
      payload: { email: "capuser@test.com", password: "user123456" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toHaveProperty("capacity");
  });
});

describe("Capacity – admin access", () => {
  let userId: string;

  beforeAll(async () => {
    const picker = await app.inject({ method: "GET", url: "/api/users/picker", headers: headers(adminToken) });
    userId = (picker.json() as { id: string; username: string }[]).find((u) => u.username === "capuser")!.id;
  });

  it("admin sees capacity in user list and detail", async () => {
    const list = await app.inject({ method: "GET", url: "/api/users", headers: headers(adminToken) });
    expect(list.statusCode).toBe(200);
    const entry = (list.json() as { id: string; capacity: unknown }[]).find((u) => u.id === userId);
    expect(entry).toHaveProperty("capacity");

    const detail = await app.inject({ method: "GET", url: `/api/users/${userId}`, headers: headers(adminToken) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toHaveProperty("capacity");
  });

  it("admin can set capacity for another user", async () => {
    const res = await app.inject({
      method: "PUT", url: `/api/users/${userId}`,
      headers: headers(adminToken),
      payload: { capacity: VALID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().capacity).toEqual(VALID);

    const detail = await app.inject({ method: "GET", url: `/api/users/${userId}`, headers: headers(adminToken) });
    expect(detail.json().capacity).toEqual(VALID);
  });

  it("non-admin cannot set capacity for others", async () => {
    const picker = await app.inject({ method: "GET", url: "/api/users/picker", headers: headers(userToken) });
    const adminId = (picker.json() as { id: string; username: string }[]).find((u) => u.username === "capadmin")!.id;

    const res = await app.inject({
      method: "PUT", url: `/api/users/${adminId}`,
      headers: headers(userToken),
      payload: { capacity: VALID },
    });
    expect(res.statusCode).toBe(403);
  });
});
