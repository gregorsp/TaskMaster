import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb, getRawDb, restoreDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { getDbState, SCHEMA_VERSION } from "../src/db/version.js";
import { createBackup, runMigration, ensureSchemaVersion } from "../src/db/migrations.js";
import { scrypt, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { users } from "../src/db/schema.js";
import { v7 as uuid } from "uuid";
import type { FastifyInstance } from "fastify";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => (err ? reject(err) : resolve(salt + ":" + k.toString("hex"))));
  });
}

describe("Migration – Version State Machine", () => {
  it("FRESH: no tables exist", async () => {
    await initDb();
    const state = getDbState(getDb(), getRawDb());
    expect(state.state).toBe("FRESH");
    expect(state.currentVersion).toBe(0);
    expect(state.targetVersion).toBe(SCHEMA_VERSION);
    closeDb();
  });

  it("Habits: is_habit and confirm_habit_completion columns exist after migration", async () => {
    await initDb();
    migrate(getDb(), { migrationsFolder: "./src/db/migrations" });
    ensureSchemaVersion();
    const taskCols = getRawDb().exec("PRAGMA table_info(tasks)")[0].values.map((c) => c[1]);
    expect(taskCols).toContain("is_habit");
    const userCols = getRawDb().exec("PRAGMA table_info(users)")[0].values.map((c) => c[1]);
    expect(userCols).toContain("confirm_habit_completion");
    closeDb();
  });
  it("UP_TO_DATE: after applying all migrations", async () => {
    await initDb();
    migrate(getDb(), { migrationsFolder: "./src/db/migrations" });
    ensureSchemaVersion();
    const state = getDbState(getDb(), getRawDb());
    expect(state.state).toBe("UP_TO_DATE");
    expect(state.currentVersion).toBe(SCHEMA_VERSION);
    closeDb();
  });

  it("MIGRATION_NEEDED: existing DB without app_meta (old DB)", async () => {
    await initDb();
    const db = getDb();
    migrate(db, { migrationsFolder: "./src/db/migrations" });
    getRawDb().run("DROP TABLE IF EXISTS app_meta");
    const state = getDbState(db, getRawDb());
    expect(state.state).toBe("MIGRATION_NEEDED");
    expect(state.currentVersion).toBe(0);
    closeDb();
  });

  it("AHEAD_OF_APP: schema version higher than code", async () => {
    await initDb();
    const db = getDb();
    migrate(db, { migrationsFolder: "./src/db/migrations" });
    // artificially bump version
    getRawDb().run("UPDATE app_meta SET value = '99' WHERE key = 'schema_version'");
    const state = getDbState(db, getRawDb());
    expect(state.state).toBe("AHEAD_OF_APP");
    expect(state.currentVersion).toBe(99);
    closeDb();
  });
});

describe("Migration – runMigration", () => {
  it("applies pending migrations and sets schema version", async () => {
    await initDb();
    const db = getDb();
    migrate(db, { migrationsFolder: "./src/db/migrations" });
    getRawDb().run("DROP TABLE IF EXISTS app_meta");

    let state = getDbState(db, getRawDb());
    expect(state.state).toBe("MIGRATION_NEEDED");

    runMigration();

    state = getDbState(db, getRawDb());
    expect(state.state).toBe("UP_TO_DATE");
    expect(state.currentVersion).toBe(SCHEMA_VERSION);
    closeDb();
  });

  it("runMigration on fresh DB applies all and sets version", async () => {
    await initDb();
    const db = getDb();

    runMigration();

    const state = getDbState(db, getRawDb());
    expect(state.state).toBe("UP_TO_DATE");
    closeDb();
  });

  it("0012: repairs corrupted planned_date literal from broken 0008 migration", async () => {
    await initDb();
    const db = getDb();
    migrate(db, { migrationsFolder: "./src/db/migrations" });

    // Need a user + task so the corruption actually affects rows
    const salt = randomBytes(16).toString("hex");
    const pw = await hashPassword("test", salt);
    const uid = uuid();
    db.insert(users).values({
      id: uid, username: "repair_user", email: "repair@test.com",
      passwordHash: pw, displayName: "Repair", isAdmin: true, createdAt: new Date(),
    }).run();
    getRawDb().run(
      `INSERT INTO tasks (id, title, is_completed, is_important, is_urgent, is_private, recurrence_type, created_by_id, created_at)
       VALUES ('t1', 'Repair me', 0, 0, 0, 0, 'none', ?, ?)`,
      [uid, Date.now()]
    );

    // Simulate the corruption introduced by 0008_boring_impossible_man:
    // the old tasks table had no planned_date column, so SQLite treated the
    // double-quoted "planned_date" as a string literal in the INSERT..SELECT.
    getRawDb().run("UPDATE tasks SET planned_date = 'planned_date'");
    const corrupted = getRawDb().exec("SELECT COUNT(*) FROM tasks WHERE planned_date = 'planned_date'")[0].values[0][0] as number;
    expect(corrupted).toBe(1);

    // Bump the version back and remove the 0012 journal record so the repair
    // migration is considered pending again (simulating the pre-update prod DB)
    getRawDb().run("UPDATE app_meta SET value = '9' WHERE key = 'schema_version'");
    const j = JSON.parse(readFileSync("./src/db/migrations/meta/_journal.json", "utf8"));
    const last = j.entries[j.entries.length - 1];
    getRawDb().run("DELETE FROM __drizzle_migrations WHERE created_at = ?", [last.when]);
    let state = getDbState(db, getRawDb());
    expect(state.state).toBe("MIGRATION_NEEDED");

    runMigration();

    state = getDbState(db, getRawDb());
    expect(state.state).toBe("UP_TO_DATE");
    expect(state.currentVersion).toBe(SCHEMA_VERSION);

    const remaining = getRawDb().exec("SELECT COUNT(*) FROM tasks WHERE planned_date = 'planned_date'")[0].values[0][0] as number;
    expect(remaining).toBe(0);
    const isNull = getRawDb().exec("SELECT planned_date FROM tasks WHERE id = 't1'")[0].values[0][0];
    expect(isNull).toBeNull();
    closeDb();
  });
});

describe("Migration – createBackup", () => {
  it("does not crash when BACKUP_DIR is empty (test env)", async () => {
    await initDb();
    migrate(getDb(), { migrationsFolder: "./src/db/migrations" });
    const path = createBackup();
    expect(path).toBe("");
    closeDb();
  });
});

describe("Migration – ensureSchemaVersion", () => {
  it("upserts schema version", async () => {
    await initDb();
    migrate(getDb(), { migrationsFolder: "./src/db/migrations" });

    getRawDb().run("UPDATE app_meta SET value = '0' WHERE key = 'schema_version'");
    let state = getDbState(getDb(), getRawDb());
    expect(state.currentVersion).toBe(0);

    ensureSchemaVersion();
    state = getDbState(getDb(), getRawDb());
    expect(state.currentVersion).toBe(SCHEMA_VERSION);
    closeDb();
  });
});

describe("Migration – restoreDb", () => {
  it("restores DB from a backup export", async () => {
    await initDb();
    const db = getDb();
    migrate(db, { migrationsFolder: "./src/db/migrations" });

    const salt = randomBytes(16).toString("hex");
    const pw = await hashPassword("test", salt);
    db.insert(users).values({
      id: uuid(), username: "testuser", email: "test@test.com",
      passwordHash: pw, displayName: "Test", isAdmin: true, createdAt: new Date(),
    }).run();

    const raw = getRawDb();
    const backup = Buffer.from(raw.export());

    // modify DB
    raw.run("DELETE FROM users WHERE email = 'test@test.com'");
    const afterDelete = raw.exec("SELECT COUNT(*) as c FROM users")[0].values[0][0] as number;
    expect(afterDelete).toBe(0);

    // write backup to temp file
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpFile = path.join(os.tmpdir(), `tm-restore-test-${uuid()}.db`);
    writeFileSync(tmpFile, backup);

    await restoreDb(tmpFile);

    const restored = getRawDb().exec("SELECT COUNT(*) as c FROM users")[0].values[0][0] as number;
    expect(restored).toBe(1);

    unlinkSync(tmpFile);
    closeDb();
  });
});

describe("Migration – API Routes (maintenance mode)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    await initDb();
    const db = getDb();
    migrate(db, { migrationsFolder: "./src/db/migrations" });
    ensureSchemaVersion();

    const salt = randomBytes(16).toString("hex");
    const pw = await hashPassword("admin123admin", salt);
    db.insert(users).values({
      id: uuid(), username: "admin_mig", email: "admin_mig@test.com",
      passwordHash: pw, displayName: "Admin", isAdmin: true, createdAt: new Date(),
    }).run();

    app = await buildApp({ migrationMode: true });
    await app.ready();

    const login = await app.inject({
      method: "POST", url: "/api/auth/login",
      payload: { email: "admin_mig@test.com", password: "admin123admin" },
    });
    adminToken = login.json().accessToken;
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  it("GET /api/migration/status requires admin auth", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/migration/status",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/migration/status returns status for admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/migration/status",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("migrationRequired");
    expect(body).toHaveProperty("currentVersion");
    expect(body).toHaveProperty("targetVersion");
    expect(body).toHaveProperty("state");
  });

  it("POST /api/migration/run requires admin auth", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/migration/run",
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/migration/run returns success when already up to date", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/migration/run",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("already up to date");
  });

  it("Health endpoint shows migrationRequired in maintenance mode", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/health",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.migrationRequired).toBe(true);
    expect(body.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("Data routes are not registered in maintenance mode", async () => {
    expect(app.hasRoute({ method: "GET", url: "/api/tasks" })).toBe(false);
    expect(app.hasRoute({ method: "GET", url: "/api/categories" })).toBe(false);
    expect(app.hasRoute({ method: "GET", url: "/api/users" })).toBe(false);
    expect(app.hasRoute({ method: "GET", url: "/api/calendar" })).toBe(false);
  });
});
