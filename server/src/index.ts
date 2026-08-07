import { buildApp } from "./app.js";
import { initDb, getDb, saveDb, closeDb, startAutoSave, stopAutoSave } from "./db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { config } from "./config.js";
import { users } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { scrypt, randomBytes } from "node:crypto";
import { v7 as uuid } from "uuid";

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

  migrate(getDb(), { migrationsFolder: "./src/db/migrations" });
  await seedAdmin();
  startAutoSave();

  const app = await buildApp();

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
    console.log(`Server running on http://0.0.0.0:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => { console.error("Startup failed:", err); process.exit(1); });
