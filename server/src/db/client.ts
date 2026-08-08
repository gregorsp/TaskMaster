import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from "sql.js";
import { drizzle, SQLJsDatabase } from "drizzle-orm/sql-js";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

let db: SQLJsDatabase;
let sql: SqlJsDatabase;
let SqlStatic: SqlJsStatic | null = null;

export async function initDb(): Promise<SQLJsDatabase> {
  const SQL = await initSqlJs();
  SqlStatic = SQL;

  if (config.dbPath === ":memory:") {
    sql = new SQL.Database();
  } else {
    const dir = path.dirname(config.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(config.dbPath)) {
      const buffer = readFileSync(config.dbPath);
      sql = new SQL.Database(buffer);
    } else {
      sql = new SQL.Database();
    }
  }

  sql.run("PRAGMA foreign_keys = ON");

  db = drizzle(sql);
  return db;
}

export function getDb(): SQLJsDatabase {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

export function saveDb(): void {
  if (!sql) return;
  if (config.dbPath === ":memory:") return;
  const dir = path.dirname(config.dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const data = sql.export();
  const buffer = Buffer.from(data);
  writeFileSync(config.dbPath, buffer);
}

let saveInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSave(intervalMs = 5000): void {
  if (saveInterval) return;
  saveInterval = setInterval(saveDb, intervalMs);
}

export function stopAutoSave(): void {
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
}

export function closeDb(): void {
  saveDb();
  sql.close();
}

export function getRawDb(): SqlJsDatabase {
  if (!sql) throw new Error("Database not initialized. Call initDb() first.");
  return sql;
}

export async function restoreDb(backupPath: string): Promise<SQLJsDatabase> {
  if (!SqlStatic) throw new Error("Database not initialized. Call initDb() first.");
  const buffer = readFileSync(backupPath);
  sql.close();
  sql = new SqlStatic.Database(buffer);
  sql.run("PRAGMA foreign_keys = ON");
  db = drizzle(sql);
  return db;
}

export { sql };
