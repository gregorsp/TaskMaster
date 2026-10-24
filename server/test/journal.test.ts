import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { users } from "../src/db/schema.js";
import { v7 as uuid } from "uuid";
import { scrypt, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => (err ? reject(err) : resolve(salt + ":" + k.toString("hex"))));
  });
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

let app: FastifyInstance;
let token: string;
let otherToken: string;
const today = isoDate(new Date());

function headers(t: string) {
  return { authorization: `Bearer ${t}` };
}

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  for (const account of [
    { email: "journal@test.com", username: "journaluser" },
    { email: "fremd@test.com", username: "fremduser" },
  ]) {
    const salt = randomBytes(16).toString("hex");
    const pw = await hashPassword("journalpass123", salt);
    db.insert(users)
      .values({
        id: uuid(),
        username: account.username,
        email: account.email,
        passwordHash: pw,
        displayName: account.username,
        isAdmin: false,
        createdAt: new Date(),
      })
      .run();
  }

  app = await buildApp();
  await app.ready();

  const login = async (email: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "journalpass123" },
    });
    return res.json().accessToken as string;
  };

  token = await login("journal@test.com");
  otherToken = await login("fremd@test.com");
});

describe("Tagebuch – Fragen", () => {
  it("legt beim ersten Aufruf drei Startfragen an", async () => {
    const res = await app.inject({ method: "GET", url: "/api/journal/questions", headers: headers(token) });
    expect(res.statusCode).toBe(200);
    const questions = res.json().questions as Array<{ text: string }>;
    expect(questions).toHaveLength(3);
    expect(questions[0].text).toContain("richtig gemacht");
  });

  it("legt Fragen an, ändert sie und archiviert statt zu löschen", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/journal/questions",
      headers: headers(token),
      payload: { text: "Woran denke ich oft?" },
    });
    expect(created.statusCode).toBe(201);
    const questionId = created.json().id as string;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/journal/questions/${questionId}`,
      headers: headers(token),
      payload: { text: "Woran denke ich gerade oft?" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().text).toBe("Woran denke ich gerade oft?");

    const archived = await app.inject({
      method: "DELETE",
      url: `/api/journal/questions/${questionId}`,
      headers: headers(token),
    });
    expect(archived.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/journal/questions", headers: headers(token) });
    const archivedRow = (list.json().questions as Array<{ id: string; archivedAt: string | null }>).find(
      (question) => question.id === questionId
    );
    expect(archivedRow?.archivedAt).toBeTruthy();
  });
});

describe("Tagebuch – Tag, Antworten, Einträge", () => {
  it("speichert Antworten pro Tag und liefert sie im Tagesbild", async () => {
    const questions = await app.inject({ method: "GET", url: "/api/journal/questions", headers: headers(token) });
    const questionId = questions.json().questions[0].id as string;

    const saved = await app.inject({
      method: "PUT",
      url: "/api/journal/answers",
      headers: headers(token),
      payload: { questionId, date: today, text: "Viel geschafft." },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().answer.text).toBe("Viel geschafft.");

    const day = await app.inject({
      method: "GET",
      url: `/api/journal/day?date=${today}`,
      headers: headers(token),
    });
    expect(day.statusCode).toBe(200);
    const answered = (day.json().questions as Array<{ id: string; answer: { text: string } | null }>).find(
      (question) => question.id === questionId
    );
    expect(answered?.answer?.text).toBe("Viel geschafft.");

    const cleared = await app.inject({
      method: "PUT",
      url: "/api/journal/answers",
      headers: headers(token),
      payload: { questionId, date: today, text: "   " },
    });
    expect(cleared.json().answer.text).toBe("");

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/journal/answers?questionId=${questionId}&date=${today}`,
      headers: headers(token),
    });
    expect(removed.statusCode).toBe(200);
  });

  it("führt mehrere Einträge pro Tag", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/journal/entries",
      headers: headers(token),
      payload: { date: today, text: "Morgen war ruhig." },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/api/journal/entries",
      headers: headers(token),
      payload: { date: today, text: "Abend war laut." },
    });
    expect(second.statusCode).toBe(201);

    const day = await app.inject({
      method: "GET",
      url: `/api/journal/day?date=${today}`,
      headers: headers(token),
    });
    expect((day.json().entries as unknown[]).length).toBe(2);

    const entryId = first.json().id as string;
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/journal/entries/${entryId}`,
      headers: headers(token),
      payload: { text: "Morgen war sehr ruhig." },
    });
    expect(patched.statusCode).toBe(200);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/journal/entries/${entryId}`,
      headers: headers(token),
    });
    expect(deleted.statusCode).toBe(200);
  });

  it("liefert Verlauf mit Kennzahl und schützt fremde Fragen", async () => {
    const questions = await app.inject({ method: "GET", url: "/api/journal/questions", headers: headers(token) });
    const questionId = questions.json().questions[0].id as string;

    await app.inject({
      method: "PUT",
      url: "/api/journal/answers",
      headers: headers(token),
      payload: { questionId, date: today, text: "Antwort von heute." },
    });

    const history = await app.inject({
      method: "GET",
      url: `/api/journal/questions/${questionId}/history`,
      headers: headers(token),
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().stats.answeredDays).toBe(1);
    expect(history.json().stats.streak).toBe(1);

    const foreign = await app.inject({
      method: "GET",
      url: `/api/journal/questions/${questionId}/history`,
      headers: headers(otherToken),
    });
    expect(foreign.statusCode).toBe(404);
  });
});
