import { eq } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { categories, taskCategories } from "../../db/schema.js";
import { autoColor } from "./colors.js";

export function listCategories() {
  const db = getDb();
  return db.select().from(categories).all();
}

export function createCategory(name: string, createdById: string, color?: string) {
  const db = getDb();

  const existing = db.select({ color: categories.color }).from(categories).all();
  const existingColors = existing.map((c) => c.color);

  const cat = {
    id: uuid(),
    name,
    color: color || autoColor(existingColors),
    createdById,
    createdAt: new Date(),
  };

  db.insert(categories).values(cat).run();
  return cat;
}

export function updateCategory(id: string, name?: string, color?: string) {
  const db = getDb();
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) return null;

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (color !== undefined) updates.color = color;

  if (Object.keys(updates).length > 0) {
    db.update(categories).set(updates).where(eq(categories.id, id)).run();
  }

  return db.select().from(categories).where(eq(categories.id, id)).get();
}

export function deleteCategory(id: string): boolean {
  const db = getDb();
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) return false;

  db.delete(taskCategories).where(eq(taskCategories.categoryId, id)).run();
  db.delete(categories).where(eq(categories.id, id)).run();

  return true;
}
