import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { eq } from "drizzle-orm";
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
let base: string;
let cookies: string[] = [];

async function req(method: string, path: string, opts: { body?: unknown; cookie?: boolean; auth?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.cookie && cookies.length) headers["Cookie"] = cookies.join("; ");
  if (opts.auth) headers["Authorization"] = `Bearer ${opts.auth}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const name = setCookie.split(";")[0];
    cookies = cookies.filter((c) => !c.startsWith(name.split("=")[0] + "="));
    cookies.push(name);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body, setCookie };
}

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const salt = randomBytes(16).toString("hex");
  const pw = await hashPassword("admin123", salt);
  db.insert(users).values({
    id: uuid(), username: "httptest", email: "http@test.com",
    passwordHash: pw, displayName: "HTTP Test", isAdmin: true, createdAt: new Date(),
  }).run();

  app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app.close();
  closeDb();
});

describe("HTTP Auth-Flow (real HTTP + Cookies)", () => {
  it("login setzt Refresh-Cookie und liefert Access-Token", async () => {
    const res = await req("POST", "/api/auth/login", { body: { email: "http@test.com", password: "admin123" } });
    expect(res.status).toBe(200);
    expect((res.body as { accessToken: string }).accessToken).toBeDefined();
    expect(res.setCookie).toBeTruthy();
  });

  it("me funktioniert mit Bearer-Token", async () => {
    const login = await req("POST", "/api/auth/login", { body: { email: "http@test.com", password: "admin123" } });
    const token = (login.body as { accessToken: string }).accessToken;
    const res = await req("GET", "/api/auth/me", { auth: token });
    expect(res.status).toBe(200);
    expect((res.body as { user: { email: string } }).user.email).toBe("http@test.com");
  });

  it("refresh liefert neuen Token wenn Cookie vorhanden", async () => {
    await req("POST", "/api/auth/login", { body: { email: "http@test.com", password: "admin123" } });
    const res = await req("POST", "/api/auth/refresh", { cookie: true });
    expect(res.status).toBe(200);
    expect((res.body as { accessToken: string }).accessToken).toBeDefined();
  });

  it("refresh ohne Cookie gibt 401 (kein Redirect-Loop)", async () => {
    const res = await req("POST", "/api/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("falsches Passwort gibt 401", async () => {
    const res = await req("POST", "/api/auth/login", { body: { email: "http@test.com", password: "falsch" } });
    expect(res.status).toBe(401);
  });

  it("PUT /me aktualisiert Profil", async () => {
    const login = await req("POST", "/api/auth/login", { body: { email: "http@test.com", password: "admin123" } });
    const token = (login.body as { accessToken: string }).accessToken;

    const res = await req("PUT", "/api/auth/me", {
      auth: token,
      body: { displayName: "Real HTTP Updated", email: "http@test.com" },
    });
    console.log("PUT /me status:", res.status);
    console.log("PUT /me body:", JSON.stringify(res.body));
    expect(res.status).toBe(200);
    expect((res.body as { user: { displayName: string } }).user.displayName).toBe("Real HTTP Updated");

    const me = await req("GET", "/api/auth/me", { auth: token });
    console.log("GET /me body:", JSON.stringify(me.body));
    expect((me.body as { user: { displayName: string } }).user.displayName).toBe("Real HTTP Updated");
  });
});
