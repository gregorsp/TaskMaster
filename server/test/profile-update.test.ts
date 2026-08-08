import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let accessToken: string;

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDb();
});

describe("Profile update flow", () => {
  it("register and login", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "pftest",
        email: "pftest@test.com",
        password: "password123",
        displayName: "Original Name",
      },
    });
    expect(res.statusCode).toBe(201);

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "pftest@test.com", password: "password123" },
    });
    expect(loginRes.statusCode).toBe(200);

    const loginBody = loginRes.json();
    accessToken = loginBody.accessToken;
    expect(loginBody.user.displayName).toBe("Original Name");
  });

  it("PUT /me updates display name", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { displayName: "Updated Name", email: "pftest@test.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.displayName).toBe("Updated Name");
  });

  it("GET /me returns updated name", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.displayName).toBe("Updated Name");
  });
});
