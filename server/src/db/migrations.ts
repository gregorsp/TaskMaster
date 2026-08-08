import { getDb, sql, getRawDb } from "./client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { config } from "../config.js";
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION } from "./version.js";
import { appMeta } from "./schema.js";

export function createBackup(): string {
  const backupDir = config.backupDir;
  if (!backupDir) return "";

  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `taskmaster-backup-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupName);

  const data = sql.export();
  writeFileSync(backupPath, Buffer.from(data));

  pruneBackups();
  return backupPath;
}

function pruneBackups(): void {
  const dir = config.backupDir;
  if (!dir || !existsSync(dir)) return;

  const files = readdirSync(dir)
    .filter((f) => f.startsWith("taskmaster-backup-") && f.endsWith(".db"))
    .sort();

  if (files.length <= config.backupKeep) return;

  const toRemove = files.slice(0, files.length - config.backupKeep);
  for (const f of toRemove) {
    try {
      unlinkSync(path.join(dir, f));
    } catch {
      // ignore prune errors
    }
  }
}

export function ensureSchemaVersion(): void {
  const db = getDb();
  try {
    db.insert(appMeta)
      .values({ key: "schema_version", value: String(SCHEMA_VERSION) })
      .onConflictDoUpdate({ target: appMeta.key, set: { value: String(SCHEMA_VERSION) } })
      .run();
  } catch {
    getRawDb().run("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
    db.insert(appMeta)
      .values({ key: "schema_version", value: String(SCHEMA_VERSION) })
      .onConflictDoUpdate({ target: appMeta.key, set: { value: String(SCHEMA_VERSION) } })
      .run();
  }
}

export function runMigration(): void {
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  ensureSchemaVersion();
}
