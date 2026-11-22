import { eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import { getDb } from "../db/client.js";

/** Fehler im Format, das der globale Error-Handler in `{ error: { code, message } }` umwandelt. */
export function notFound(what: string) {
  return Object.assign(new Error(`${what} not found`), { statusCode: 404, code: "NOT_FOUND" });
}

/**
 * Lädt einen Datensatz, der genau einem Nutzer gehört (z. B. Mindmaps). Fremde und unbekannte IDs sind gleichermaßen 404 – so lässt sich
 * nicht erraten, welche IDs existieren.
 */
export function findOwned<T extends SQLiteTableWithColumns<any> & { id: SQLiteColumn; userId: SQLiteColumn }>(
  table: T, id: string, userId: string, what: string,
): T["$inferSelect"] {
  const row = getDb().select().from(table).where(eq(table.id, id)).get() as T["$inferSelect"] | undefined;
  if (!row || row.userId !== userId) throw notFound(what);
  return row;
}
