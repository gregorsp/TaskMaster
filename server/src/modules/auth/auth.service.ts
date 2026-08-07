import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema.js";
import type { RegisterInput } from "./auth.schema.js";

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
    createdAt: new Date(),
  };

  db.insert(users).values(user).run();

  return { id: user.id, username: user.username, email: user.email, displayName: user.displayName, isAdmin: user.isAdmin };
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

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
  };
}

export async function getUserById(id: string) {
  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
  };
}
