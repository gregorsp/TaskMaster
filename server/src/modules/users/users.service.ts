import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { users, taskAssignees } from "../../db/schema.js";
import { scrypt, randomBytes } from "node:crypto";
import { getProfilePictureUrl, deleteProfilePictureFiles } from "../auth/profile.service.js";
import { parseCapacity, serializeCapacity, type Capacity } from "../../lib/capacity.js";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(salt + ":" + derivedKey.toString("hex"));
    });
  });
}

function userToResponse(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    profilePicture: getProfilePictureUrl(user.profilePicture),
    capacity: parseCapacity(user.capacity),
    createdAt: user.createdAt,
  };
}

function countAdmins(): number {
  const db = getDb();
  return db.select().from(users).where(eq(users.isAdmin, true)).all().length;
}

function assertNotLastAdmin(userId: string): void {
  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || !user.isAdmin) return;

  if (countAdmins() <= 1) {
    throw Object.assign(new Error("Cannot remove the last admin"), { statusCode: 403, code: "LAST_ADMIN" });
  }
}

export function listUsers() {
  const db = getDb();
  const all = db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      displayName: users.displayName,
      isAdmin: users.isAdmin,
      profilePicture: users.profilePicture,
      capacity: users.capacity,
      createdAt: users.createdAt,
    })
    .from(users)
    .all();

  return all.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.displayName,
    isAdmin: u.isAdmin,
    profilePicture: getProfilePictureUrl(u.profilePicture),
    capacity: parseCapacity(u.capacity),
    createdAt: u.createdAt,
  }));
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
      profilePicture: users.profilePicture,
      capacity: users.capacity,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .get();

  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    profilePicture: getProfilePictureUrl(user.profilePicture),
    capacity: parseCapacity(user.capacity),
    createdAt: user.createdAt,
  };
}

export async function updateUser(id: string, input: { username?: string; email?: string; displayName?: string; isAdmin?: boolean; password?: string; capacity?: Capacity | null }) {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (!existing) return null;

  if (input.isAdmin === false) {
    assertNotLastAdmin(id);
  }

  const updates: Record<string, unknown> = {};
  if (input.username !== undefined) updates.username = input.username;
  if (input.email !== undefined) updates.email = input.email;
  if (input.displayName !== undefined) updates.displayName = input.displayName;
  if (input.isAdmin !== undefined) updates.isAdmin = input.isAdmin;
  if (input.capacity !== undefined) updates.capacity = serializeCapacity(input.capacity);

  if (input.password !== undefined && input.password.length > 0) {
    const salt = randomBytes(16).toString("hex");
    updates.passwordHash = await hashPassword(input.password, salt);
  }

  if (Object.keys(updates).length > 0) {
    db.update(users).set(updates).where(eq(users.id, id)).run();
  }

  return getUser(id);
}

export async function deleteUser(id: string): Promise<boolean> {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (!existing) return false;

  assertNotLastAdmin(id);

  deleteProfilePictureFiles(existing.profilePicture);

  db.delete(taskAssignees).where(eq(taskAssignees.userId, id)).run();
  db.delete(users).where(eq(users.id, id)).run();

  return true;
}
