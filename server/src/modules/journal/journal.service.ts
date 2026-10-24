import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { journalAnswers, journalEntries, journalQuestions } from "../../db/schema.js";
import { listRecordingsForOwners, deleteRecordingsForOwner } from "../recordings/recordings.service.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SEED_QUESTIONS = [
  "Was hast du heute richtig gemacht?",
  "Was nimmst du dir für morgen vor?",
  "Wofür bist du heute dankbar?",
];

export function assertIsoDate(date: string): string {
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) {
    throw Object.assign(new Error("Datum muss dem Format YYYY-MM-DD entsprechen"), {
      statusCode: 400,
      code: "INVALID_DATE",
    });
  }
  return date;
}

export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
}

export function ensureSeedQuestions(userId: string): void {
  const db = getDb();
  const existing = db
    .select({ id: journalQuestions.id })
    .from(journalQuestions)
    .where(eq(journalQuestions.userId, userId))
    .get();
  if (existing) return;

  const now = new Date();
  SEED_QUESTIONS.forEach((text, index) => {
    db.insert(journalQuestions)
      .values({ id: uuid(), userId, text, position: index, createdAt: now })
      .run();
  });
}

export function listQuestions(userId: string) {
  ensureSeedQuestions(userId);
  return getDb()
    .select()
    .from(journalQuestions)
    .where(eq(journalQuestions.userId, userId))
    .orderBy(asc(journalQuestions.position), asc(journalQuestions.createdAt))
    .all();
}

export function createQuestion(userId: string, text: string) {
  const db = getDb();
  const max = db
    .select({ position: sql<number>`coalesce(max(${journalQuestions.position}), -1)` })
    .from(journalQuestions)
    .where(eq(journalQuestions.userId, userId))
    .get();
  const row = {
    id: uuid(),
    userId,
    text,
    position: (max?.position ?? -1) + 1,
    archivedAt: null,
    createdAt: new Date(),
  };
  db.insert(journalQuestions).values(row).run();
  return row;
}

export function updateQuestion(
  userId: string,
  questionId: string,
  patch: { text?: string; position?: number }
) {
  const db = getDb();
  const existing = db
    .select()
    .from(journalQuestions)
    .where(and(eq(journalQuestions.id, questionId), eq(journalQuestions.userId, userId)))
    .get();
  if (!existing) return null;

  const updates: Record<string, unknown> = {};
  if (patch.text !== undefined) updates.text = patch.text;
  if (patch.position !== undefined) updates.position = patch.position;
  if (Object.keys(updates).length > 0) {
    db.update(journalQuestions).set(updates).where(eq(journalQuestions.id, questionId)).run();
  }
  return db.select().from(journalQuestions).where(eq(journalQuestions.id, questionId)).get();
}

export function archiveQuestion(userId: string, questionId: string) {
  const db = getDb();
  const existing = db
    .select()
    .from(journalQuestions)
    .where(and(eq(journalQuestions.id, questionId), eq(journalQuestions.userId, userId)))
    .get();
  if (!existing) return null;
  db.update(journalQuestions)
    .set({ archivedAt: new Date() })
    .where(eq(journalQuestions.id, questionId))
    .run();
  return { ok: true };
}

export function getDay(userId: string, date: string) {
  ensureSeedQuestions(userId);
  const db = getDb();

  const questions = db
    .select()
    .from(journalQuestions)
    .where(and(eq(journalQuestions.userId, userId), isNull(journalQuestions.archivedAt)))
    .orderBy(asc(journalQuestions.position), asc(journalQuestions.createdAt))
    .all();

  const answers = db
    .select()
    .from(journalAnswers)
    .where(and(eq(journalAnswers.userId, userId), eq(journalAnswers.answerDate, date)))
    .all();

  const entries = db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.userId, userId), eq(journalEntries.entryDate, date)))
    .orderBy(desc(journalEntries.createdAt))
    .all();

  const answerRecordings = listRecordingsForOwners(
    "journal_answer",
    answers.map((answer) => answer.id)
  );
  const entryRecordings = listRecordingsForOwners(
    "journal_entry",
    entries.map((entry) => entry.id)
  );

  return {
    date,
    questions: questions.map((question) => {
      const answer = answers.find((candidate) => candidate.questionId === question.id) ?? null;
      return {
        id: question.id,
        text: question.text,
        position: question.position,
        answer,
        recording: answer ? answerRecordings.find((recording) => recording.ownerId === answer.id) ?? null : null,
      };
    }),
    entries: entries.map((entry) => ({
      ...entry,
      recordings: entryRecordings.filter((recording) => recording.ownerId === entry.id),
    })),
  };
}

export function createEntry(userId: string, date: string, text: string) {
  const db = getDb();
  const now = new Date();
  const row = {
    id: uuid(),
    userId,
    entryDate: date,
    text,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(journalEntries).values(row).run();
  return row;
}

export function updateEntry(userId: string, entryId: string, text: string) {
  const db = getDb();
  const existing = db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.userId, userId)))
    .get();
  if (!existing) return null;
  db.update(journalEntries).set({ text, updatedAt: new Date() }).where(eq(journalEntries.id, entryId)).run();
  return db.select().from(journalEntries).where(eq(journalEntries.id, entryId)).get();
}

export function deleteEntry(userId: string, entryId: string): boolean {
  const db = getDb();
  const existing = db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.userId, userId)))
    .get();
  if (!existing) return false;
  db.delete(journalEntries).where(eq(journalEntries.id, entryId)).run();
  return true;
}

export function setAnswer(userId: string, questionId: string, date: string, text: string) {
  const db = getDb();
  const question = db
    .select()
    .from(journalQuestions)
    .where(and(eq(journalQuestions.id, questionId), eq(journalQuestions.userId, userId)))
    .get();
  if (!question) {
    throw Object.assign(new Error("Frage nicht gefunden"), { statusCode: 404, code: "NOT_FOUND" });
  }

  const existing = db
    .select()
    .from(journalAnswers)
    .where(
      and(
        eq(journalAnswers.userId, userId),
        eq(journalAnswers.questionId, questionId),
        eq(journalAnswers.answerDate, date)
      )
    )
    .get();

  const trimmed = text.trim();
  if (existing) {
    db.update(journalAnswers)
      .set({ text: trimmed, updatedAt: new Date() })
      .where(eq(journalAnswers.id, existing.id))
      .run();
    return db.select().from(journalAnswers).where(eq(journalAnswers.id, existing.id)).get();
  }

  const now = new Date();
  const row = {
    id: uuid(),
    userId,
    questionId,
    answerDate: date,
    text: trimmed,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(journalAnswers).values(row).run();
  return row;
}

export function deleteAnswer(userId: string, questionId: string, date: string): boolean {
  const db = getDb();
  const existing = db
    .select()
    .from(journalAnswers)
    .where(
      and(
        eq(journalAnswers.userId, userId),
        eq(journalAnswers.questionId, questionId),
        eq(journalAnswers.answerDate, date)
      )
    )
    .get();
  if (!existing) return false;

  deleteRecordingsForOwner(userId, "journal_answer", existing.id);
  db.delete(journalAnswers).where(eq(journalAnswers.id, existing.id)).run();
  return true;
}

export function getQuestionHistory(userId: string, questionId: string) {
  const db = getDb();
  const question = db
    .select()
    .from(journalQuestions)
    .where(and(eq(journalQuestions.id, questionId), eq(journalQuestions.userId, userId)))
    .get();
  if (!question) return null;

  const answers = db
    .select()
    .from(journalAnswers)
    .where(and(eq(journalAnswers.userId, userId), eq(journalAnswers.questionId, questionId)))
    .orderBy(desc(journalAnswers.answerDate))
    .all();

  const recordings = listRecordingsForOwners(
    "journal_answer",
    answers.map((answer) => answer.id)
  );

  const answeredDates = new Set(answers.map((answer) => answer.answerDate));
  let streak = 0;
  const startOffset = answeredDates.has(isoDate(new Date())) ? 0 : 1;
  for (let offset = startOffset; offset < 3660; offset++) {
    if (!answeredDates.has(daysAgo(offset))) break;
    streak += 1;
  }

  return {
    question,
    answers: answers.map((answer) => ({
      ...answer,
      recording: recordings.find((recording) => recording.ownerId === answer.id) ?? null,
    })),
    stats: { answeredDays: answers.length, streak },
  };
}
