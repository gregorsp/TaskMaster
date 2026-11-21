import { eq } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { contexts, taskContexts } from "../../db/schema.js";
import { autoColor } from "../categories/colors.js";

/** Die sechs Standard-Kontexte, die jeder Nutzer einmalig bekommt. */
export const DEFAULT_CONTEXTS: { name: string; color: string }[] = [
  { name: "Telefon", color: "#1e88e5" },
  { name: "Computer", color: "#8e24aa" },
  { name: "Online", color: "#43a047" },
  { name: "Zuhause", color: "#fb8c00" },
  { name: "Besorgungen", color: "#e53935" },
  { name: "Uni", color: "#3949ab" },
];

/** Legt fehlende Standard-Kontexte für einen Nutzer an (idempotent). */
export function seedDefaultContexts(userId: string): void {
  const db = getDb();
  const existing = new Set(
    db.select({ name: contexts.name }).from(contexts)
      .where(eq(contexts.createdById, userId)).all()
      .map((row) => row.name.trim().toLowerCase())
  );

  for (const context of DEFAULT_CONTEXTS) {
    if (existing.has(context.name.toLowerCase())) continue;
    db.insert(contexts).values({
      id: uuid(),
      name: context.name,
      color: context.color,
      createdById: userId,
      createdAt: new Date(),
    }).run();
  }
}

export function listContexts(userId: string) {
  const db = getDb();
  return db.select().from(contexts).where(eq(contexts.createdById, userId)).all();
}

export function createContext(name: string, createdById: string, color?: string) {
  const db = getDb();
  const trimmed = name.trim();
  const duplicate = db.select({ name: contexts.name }).from(contexts)
    .where(eq(contexts.createdById, createdById)).all()
    .some((row) => row.name.trim().toLowerCase() === trimmed.toLowerCase());

  if (duplicate) {
    throw Object.assign(new Error("Context already exists"), { statusCode: 409, code: "DUPLICATE_CONTEXT" });
  }

  const existingColors = db.select({ color: contexts.color }).from(contexts).all().map((c) => c.color);

  const context = {
    id: uuid(),
    name: trimmed,
    color: color || autoColor(existingColors),
    createdById,
    createdAt: new Date(),
  };

  db.insert(contexts).values(context).run();
  return context;
}

export function updateContext(id: string, userId: string, name?: string, color?: string) {
  const db = getDb();
  const existing = db.select().from(contexts).where(eq(contexts.id, id)).get();
  if (!existing) return null;
  if (existing.createdById !== userId) {
    throw Object.assign(new Error("Not the owner"), { statusCode: 403, code: "FORBIDDEN" });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (color !== undefined) updates.color = color;

  if (Object.keys(updates).length > 0) {
    db.update(contexts).set(updates).where(eq(contexts.id, id)).run();
  }

  return db.select().from(contexts).where(eq(contexts.id, id)).get();
}

export function deleteContext(id: string, userId: string): boolean {
  const db = getDb();
  const existing = db.select().from(contexts).where(eq(contexts.id, id)).get();
  if (!existing) return false;
  if (existing.createdById !== userId) {
    throw Object.assign(new Error("Not the owner"), { statusCode: 403, code: "FORBIDDEN" });
  }

  db.delete(taskContexts).where(eq(taskContexts.contextId, id)).run();
  db.delete(contexts).where(eq(contexts.id, id)).run();
  return true;
}

/**
 * Alle Kontext-IDs mit demselben Anzeigenamen (Namens-Gruppierung über
 * Nutzergrenzen hinweg, Groß/Kleinschreibung egal).
 */
export function contextIdsWithSameName(contextId: string): string[] {
  const db = getDb();
  const base = db.select({ name: contexts.name }).from(contexts).where(eq(contexts.id, contextId)).get();
  if (!base) return [contextId];
  const needle = base.name.trim().toLowerCase();
  return db.select({ id: contexts.id, name: contexts.name }).from(contexts).all()
    .filter((row) => row.name.trim().toLowerCase() === needle)
    .map((row) => row.id);
}
