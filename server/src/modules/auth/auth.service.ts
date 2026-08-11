import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema.js";
import type { RegisterInput } from "./auth.schema.js";
import { getProfilePictureUrl } from "./profile.service.js";
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

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(timingSafeEqual(Buffer.from(hash, "hex"), derivedKey));
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
    confirmHabitCompletion: user.confirmHabitCompletion,
  };
}

export async function registerUser(input: RegisterInput) {
  const db = getDb();

  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, input.email))
    .get();

  if (existing) {
    throw Object.assign(new Error("Email already registered"), { statusCode: 409, code: "EMAIL_EXISTS" });
  }

  const usernameExisting = db
    .select()
    .from(users)
    .where(eq(users.username, input.username))
    .get();

  if (usernameExisting) {
    throw Object.assign(new Error("Username already taken"), { statusCode: 409, code: "USERNAME_EXISTS" });
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(input.password, salt);

  const user = {
    id: uuid(),
    username: input.username,
    email: input.email,
    passwordHash,
    displayName: input.displayName,
    isAdmin: false,
    profilePicture: null,
    createdAt: new Date(),
  };

  db.insert(users).values(user).run();

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    profilePicture: null,
  };
}

export async function authenticateUser(email: string, password: string) {
  const db = getDb();

  const user = db.select().from(users).where(eq(users.email, email)).get();

  if (!user) {
    throw Object.assign(new Error("Invalid email or password"), { statusCode: 401, code: "INVALID_CREDENTIALS" });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error("Invalid email or password"), { statusCode: 401, code: "INVALID_CREDENTIALS" });
  }

  return userToResponse(user);
}

export async function getUserById(id: string) {
  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user) return null;
  return userToResponse(user);
}

export async function updateCurrentUser(id: string, input: { displayName?: string; email?: string }) {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (!existing) {
    throw Object.assign(new Error("User not found"), { statusCode: 404, code: "USER_NOT_FOUND" });
  }

  if (input.email !== undefined && input.email !== existing.email) {
    const emailTaken = db.select().from(users).where(eq(users.email, input.email)).get();
    if (emailTaken) {
      throw Object.assign(new Error("Email already in use"), { statusCode: 409, code: "EMAIL_EXISTS" });
    }
  }

  const updates: Record<string, unknown> = {};
  if (input.displayName !== undefined) updates.displayName = input.displayName;
  if (input.email !== undefined) updates.email = input.email;

  if (Object.keys(updates).length > 0) {
    db.update(users).set(updates).where(eq(users.id, id)).run();
  }

  const updated = db.select().from(users).where(eq(users.id, id)).get()!;
  return userToResponse(updated);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    throw Object.assign(new Error("User not found"), { statusCode: 404, code: "USER_NOT_FOUND" });
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error("Current password is incorrect"), { statusCode: 400, code: "INVALID_PASSWORD" });
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(newPassword, salt);

  db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
}

export function getCurrentUserCapacity(id: string): Capacity | null {
  const db = getDb();
  const user = db.select({ capacity: users.capacity }).from(users).where(eq(users.id, id)).get();
  if (!user) {
    throw Object.assign(new Error("User not found"), { statusCode: 404, code: "USER_NOT_FOUND" });
  }
  return parseCapacity(user.capacity);
}

export function updateCurrentUserCapacity(id: string, capacity: Capacity | null): Capacity | null {
  const db = getDb();
  const user = db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
  if (!user) {
    throw Object.assign(new Error("User not found"), { statusCode: 404, code: "USER_NOT_FOUND" });
  }

  const serialized = serializeCapacity(capacity);
  db.update(users).set({ capacity: serialized }).where(eq(users.id, id)).run();
  return parseCapacity(serialized);
}

export async function updateCurrentUserHabitConfirm(id: string, confirmHabitCompletion: boolean) {
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (!existing) {
    throw Object.assign(new Error("User not found"), { statusCode: 404, code: "USER_NOT_FOUND" });
  }

  db.update(users).set({ confirmHabitCompletion }).where(eq(users.id, id)).run();
  const updated = db.select().from(users).where(eq(users.id, id)).get()!;
  return userToResponse(updated);
}
