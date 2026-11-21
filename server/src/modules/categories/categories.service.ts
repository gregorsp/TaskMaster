import { eq } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { categories, taskCategories } from "../../db/schema.js";
import { autoColor } from "./colors.js";

/** Kategorien eines Nutzers. Es gibt keine globalen Kategorien mehr. */
export function listCategories(userId: string) {
  const db = getDb();
  return db.select().from(categories).where(eq(categories.createdById, userId)).all();
}

export function createCategory(name: string, createdById: string, color?: string) {
  const db = getDb();
  const trimmed = name.trim();
  const duplicate = db.select({ name: categories.name }).from(categories)
    .where(eq(categories.createdById, createdById)).all()
    .some((row) => row.name.trim().toLowerCase() === trimmed.toLowerCase());

  if (duplicate) {
    throw Object.assign(new Error("Category already exists"), { statusCode: 409, code: "DUPLICATE_CATEGORY" });
  }

  const existing = db.select({ color: categories.color }).from(categories).all();
  const existingColors = existing.map((c) => c.color);

  const cat = {
    id: uuid(),
    name: trimmed,
    color: color || autoColor(existingColors),
    createdById,
    createdAt: new Date(),
  };

  db.insert(categories).values(cat).run();
  return cat;
}

export function updateCategory(id: string, userId: string, name?: string, color?: string) {
  const db = getDb();
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) return null;
  if (existing.createdById !== userId) {
    throw Object.assign(new Error("Not the owner"), { statusCode: 403, code: "FORBIDDEN" });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (color !== undefined) updates.color = color;

  if (Object.keys(updates).length > 0) {
    db.update(categories).set(updates).where(eq(categories.id, id)).run();
  }

  return db.select().from(categories).where(eq(categories.id, id)).get();
}

export function deleteCategory(id: string, userId: string): boolean {
  const db = getDb();
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) return false;
  if (existing.createdById !== userId) {
    throw Object.assign(new Error("Not the owner"), { statusCode: 403, code: "FORBIDDEN" });
  }

  db.delete(taskCategories).where(eq(taskCategories.categoryId, id)).run();
  db.delete(categories).where(eq(categories.id, id)).run();

  return true;
}

/**
 * Alle Kategorie-IDs mit demselben Anzeigenamen (Namens-Gruppierung über
 * Nutzergrenzen hinweg, Groß/Kleinschreibung egal). Wird für den Filter
 * benutzt, damit „Uni“ unabhängig vom Besitzer dieselben Aufgaben trifft.
 */
export function categoryIdsWithSameName(categoryId: string): string[] {
  const db = getDb();
  const base = db.select({ name: categories.name }).from(categories).where(eq(categories.id, categoryId)).get();
  if (!base) return [categoryId];
  const needle = base.name.trim().toLowerCase();
  return db.select({ id: categories.id, name: categories.name }).from(categories).all()
    .filter((row) => row.name.trim().toLowerCase() === needle)
    .map((row) => row.id);
}
