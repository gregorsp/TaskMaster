import { scrypt, randomBytes } from "node:crypto";
import { v7 as uuid } from "uuid";
import { initDb, saveDb, closeDb } from "./client.js";
import { users } from "./schema.js";
import { eq } from "drizzle-orm";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(salt + ":" + derivedKey.toString("hex"));
    });
  });
}

async function seed() {
  const db = await initDb();

  const existing = db.select().from(users).where(eq(users.email, "admin@taskmaster.local")).all();
  if (existing.length > 0) {
    console.log("Admin user already exists.");
    closeDb();
    return;
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword("admin123", salt);

  const admin = {
    id: uuid(),
    username: "admin",
    email: "admin@taskmaster.local",
    passwordHash,
    displayName: "Administrator",
    isAdmin: true,
    createdAt: new Date(),
  };

  db.insert(users).values(admin).run();
  console.log("Admin user created: admin@taskmaster.local / admin123");

  saveDb();
  closeDb();
}

seed().catch(console.error);
