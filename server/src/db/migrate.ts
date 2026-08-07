import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

async function run() {
  const SQL = await initSqlJs();
  const dir = path.dirname(config.dbPath);

  if (config.dbPath !== ":memory:" && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let sql;
  if (config.dbPath === ":memory:") {
    sql = new SQL.Database();
  } else if (existsSync(config.dbPath)) {
    sql = new SQL.Database(readFileSync(config.dbPath));
  } else {
    sql = new SQL.Database();
  }

  const db = drizzle(sql);

  migrate(db, { migrationsFolder: "./src/db/migrations" });

  if (config.dbPath !== ":memory:") {
    const data = sql.export();
    writeFileSync(config.dbPath, Buffer.from(data));
  }

  console.log("Migration complete.");
  sql.close();
}

run().catch(console.error);
