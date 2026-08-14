import { SQLJsDatabase } from "drizzle-orm/sql-js";
import { Database as SqlJsRawDatabase } from "sql.js";
import { appMeta } from "./schema.js";
import { eq } from "drizzle-orm";

export const SCHEMA_VERSION = 10;

export type DbState = "FRESH" | "UP_TO_DATE" | "MIGRATION_NEEDED" | "AHEAD_OF_APP";

export interface VersionStatus {
  state: DbState;
  currentVersion: number;
  targetVersion: number;
}

function readSchemaVersion(db: SQLJsDatabase): number | null {
  try {
    const row = db.select({ value: appMeta.value }).from(appMeta).where(eq(appMeta.key, "schema_version")).get();
    return row ? parseInt(row.value, 10) : null;
  } catch {
    return null;
  }
}

function hasDrizzleMigrations(rawDb: SqlJsRawDatabase): boolean {
  try {
    const rows = rawDb.exec("SELECT COUNT(*) as count FROM __drizzle_migrations");
    if (rows.length > 0 && rows[0].values.length > 0) {
      return (rows[0].values[0][0] as number) > 0;
    }
    return false;
  } catch {
    return false;
  }
}

export function getDbState(db: SQLJsDatabase, rawDb: SqlJsRawDatabase): VersionStatus {
  const version = readSchemaVersion(db);
  if (version !== null) {
    if (version === SCHEMA_VERSION) return { state: "UP_TO_DATE", currentVersion: version, targetVersion: SCHEMA_VERSION };
    if (version < SCHEMA_VERSION) return { state: "MIGRATION_NEEDED", currentVersion: version, targetVersion: SCHEMA_VERSION };
    return { state: "AHEAD_OF_APP", currentVersion: version, targetVersion: SCHEMA_VERSION };
  }
  if (!hasDrizzleMigrations(rawDb)) {
    return { state: "FRESH", currentVersion: 0, targetVersion: SCHEMA_VERSION };
  }
  return { state: "MIGRATION_NEEDED", currentVersion: 0, targetVersion: SCHEMA_VERSION };
}
