import { migrate } from "drizzle-orm/sql-js/migrator";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import journal from "./migrations/meta/_journal.json";
import { config } from "../config.js";
import { getDb, getSql, saveDb } from "./client.js";

export interface DbMigrationStatus {
  requiresMigration: boolean;
  currentVersion: number;
  targetVersion: number;
}

function readAppliedMigrationCount(): number {
  try {
    const result = getSql().exec("SELECT COUNT(*) AS count FROM __drizzle_migrations");
    const value = result[0]?.values?.[0]?.[0];
    return typeof value === "number" ? value : Number(value ?? 0);
  } catch {
    return 0;
  }
}

function targetMigrationCount(): number {
  return journal.entries.length;
}

export function getDbMigrationStatus(): DbMigrationStatus {
  const currentVersion = readAppliedMigrationCount();
  const targetVersion = targetMigrationCount();
  return {
    requiresMigration: currentVersion < targetVersion,
    currentVersion,
    targetVersion,
  };
}

function createBackupIfNeeded(): string | null {
  if (config.dbPath === ":memory:") return null;
  if (!existsSync(config.dbPath)) return null;

  saveDb();
  const parsed = path.parse(config.dbPath);
  const ts = new Date().toISOString().replaceAll(":", "-");
  const backupPath = path.join(parsed.dir, `${parsed.name}.backup-${ts}${parsed.ext}`);
  copyFileSync(config.dbPath, backupPath);
  return backupPath;
}

export function migrateDatabaseWithBackup(): { backupPath: string | null; status: DbMigrationStatus } {
  const status = getDbMigrationStatus();
  if (!status.requiresMigration) {
    return { backupPath: null, status };
  }

  const backupPath = createBackupIfNeeded();
  migrate(getDb(), { migrationsFolder: "./src/db/migrations" });
  saveDb();
  return { backupPath, status: getDbMigrationStatus() };
}
