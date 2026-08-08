import { buildApp } from "./app.js";
import { initDb, getDb, saveDb, closeDb, startAutoSave, stopAutoSave, getRawDb } from "./db/client.js";
import { config } from "./config.js";
import { users } from "./db/schema.js";
import { scrypt, randomBytes } from "node:crypto";
import { v7 as uuid } from "uuid";
import { getDbState, SCHEMA_VERSION } from "./db/version.js";
import { runMigration } from "./db/migrations.js";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => (err ? reject(err) : resolve(salt + ":" + k.toString("hex"))));
  });
}

async function seedAdmin() {
  const db = getDb();
  const count = db.select({ id: users.id }).from(users).all().length;
  if (count > 0) return;

  const adminEmail = process.env.ADMIN_EMAIL || "admin@taskmaster.local";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(adminPassword, salt);

  db.insert(users).values({
    id: uuid(),
    username: "admin",
    email: adminEmail,
    passwordHash,
    displayName: "Administrator",
    isAdmin: true,
    createdAt: new Date(),
  }).run();

  console.log(`Admin created: ${adminEmail}`);
}

async function main() {
  await initDb();

  const state = getDbState(getDb(), getRawDb());

  if (state.state === "AHEAD_OF_APP") {
    console.error(
      `DB schema version (${state.currentVersion}) is ahead of app (${SCHEMA_VERSION}). Refusing to start.`,
    );
    process.exit(1);
  }

  if (state.state === "FRESH") {
    console.log("Fresh database, applying all migrations...");
    runMigration();
    await seedAdmin();
  }

  if (state.state === "MIGRATION_NEEDED") {
    if (config.autoMigrate) {
      console.log(`Auto-migrating DB from v${state.currentVersion} to v${SCHEMA_VERSION}...`);
      runMigration();
      console.log("Migration complete.");
    } else {
      console.log(
        `DB needs migration (v${state.currentVersion} → v${SCHEMA_VERSION}). Starting in maintenance mode.`,
      );
    }
  }

  startAutoSave();

  const migrationMode = state.state === "MIGRATION_NEEDED" && !config.autoMigrate;
  const app = await buildApp({ migrationMode });

  const gracefulShutdown = async () => {
    app.log.info("Shutting down...");
    await app.close();
    stopAutoSave();
    saveDb();
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  try {
    await app.listen({ port: config.port, host: config.host });
    const mode = migrationMode ? "maintenance (migration required)" : "normal";
    console.log(`Server running on http://0.0.0.0:${config.port} (${mode})`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => { console.error("Startup failed:", err); process.exit(1); });
