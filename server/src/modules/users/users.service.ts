import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { users, taskAssignees } from "../../db/schema.js";

export function listUsers() {
  const db = getDb();
  return db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      displayName: users.displayName,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    })
    .from(users)
    .all();
}

export function getUser(id: string) {
  const db = getDb();
  const user = db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      displayName: users.displayName,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .get();

  return user ?? null;
}

export function updateUser(id: string, input: { username?: string; email?: string; displayName?: string; isAdmin?: boolean; password?: string }) {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (!existing) return null;

  const updates: Record<string, unknown> = {};
  if (input.username !== undefined) updates.username = input.username;
  if (input.email !== undefined) updates.email = input.email;
  if (input.displayName !== undefined) updates.displayName = input.displayName;
  if (input.isAdmin !== undefined) updates.isAdmin = input.isAdmin;

  if (Object.keys(updates).length > 0) {
    db.update(users).set(updates).where(eq(users.id, id)).run();
  }

  return getUser(id);
}

export async function deleteUser(id: string): Promise<boolean> {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (!existing) return false;

  db.delete(taskAssignees).where(eq(taskAssignees.userId, id)).run();
  db.delete(users).where(eq(users.id, id)).run();

  return true;
}
