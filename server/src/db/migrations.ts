import { getDb, sql, getRawDb } from "./client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { config } from "../config.js";
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
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
  repairMigrationTimestamps();
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  ensureSchemaVersion();
}

/**
 * Repariert inkonsistente `created_at`-Werte in `__drizzle_migrations`.
 *
 * Drizzle's Migrator wendet eine Migration nur an, wenn ihr `when`-Timestamp
 * größer ist als der der zuletzt angewendeten Migration. Wenn ein Migrationseintrag
 * im Journal einen `when`-Wert in der Zukunft trägt (z. B. durch eine fehlerhafte
 * Systemuhr beim Generieren), bekommen nachfolgend generierte Migrationen einen
 * niedrigeren `when`-Wert und werden stillschweigend übersprungen – die Spalten
 * fehlen dann, obwohl `schema_version` bereits hochgezählt wurde.
 *
 * Diese Funktion gleicht die `created_at`-Werte der bereits angewendeten
 * Migrationen mit den (korrigierten) Journal-Timestamps ab und ist idempotent.
 */
function repairMigrationTimestamps(): void {
  const raw = getRawDb();
  try {
    const journalPath = path.join("src", "db", "migrations", "meta", "_journal.json");
    if (!existsSync(journalPath)) return;
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { when: number }[] };

    const rows = raw.exec("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC");
    if (rows.length === 0 || rows[0].values.length === 0) return;

    const applied = rows[0].values as [string, number][];
    const entries = [...journal.entries].sort((a, b) => a.when - b.when);

    for (let i = 0; i < applied.length && i < entries.length; i++) {
      if (applied[i][1] !== entries[i].when) {
        raw.run("UPDATE __drizzle_migrations SET created_at = ? WHERE hash = ?", [entries[i].when, applied[i][0]]);
      }
    }
  } catch {
    // Nicht fatal: `migrate()` unten meldet echte Fehler.
  }
}
