import client from "./client";
import type { NoteRecording } from "./notesApi";

export interface JournalQuestion {
  id: string;
  text: string;
  position: number;
  archivedAt: string | null;
  createdAt: string;
}

export interface JournalAnswer {
  id: string;
  userId: string;
  questionId: string;
  answerDate: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntry {
  id: string;
  entryDate: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  recordings: NoteRecording[];
}

export interface JournalDayQuestion {
  id: string;
  text: string;
  position: number;
  answer: JournalAnswer | null;
  recording: NoteRecording | null;
}

export interface JournalDay {
  date: string;
  questions: JournalDayQuestion[];
  entries: JournalEntry[];
}

export interface QuestionHistory {
  question: JournalQuestion;
  answers: Array<JournalAnswer & { recording: NoteRecording | null }>;
  stats: { answeredDays: number; streak: number };
}

export async function listQuestions(): Promise<{ questions: JournalQuestion[] }> {
  const { data } = await client.get("/journal/questions");
  return data;
}

export async function createQuestion(text: string): Promise<JournalQuestion> {
  const { data } = await client.post("/journal/questions", { text });
  return data;
}

export async function updateQuestion(
  id: string,
  patch: { text?: string; position?: number }
): Promise<JournalQuestion> {
  const { data } = await client.patch(`/journal/questions/${id}`, patch);
  return data;
}

export async function archiveQuestion(id: string): Promise<void> {
  await client.delete(`/journal/questions/${id}`);
}

export async function getQuestionHistory(id: string): Promise<QuestionHistory> {
  const { data } = await client.get(`/journal/questions/${id}/history`);
  return data;
}

export async function getDay(date: string): Promise<JournalDay> {
  const { data } = await client.get("/journal/day", { params: { date } });
  return data;
}

export async function createEntry(date: string, text: string): Promise<JournalEntry> {
  const { data } = await client.post("/journal/entries", { date, text });
  return data;
}

export async function updateEntry(id: string, text: string): Promise<JournalEntry> {
  const { data } = await client.patch(`/journal/entries/${id}`, { text });
  return data;
}

export async function deleteEntry(id: string): Promise<void> {
  await client.delete(`/journal/entries/${id}`);
}

export async function setAnswer(
  questionId: string,
  date: string,
  text: string
): Promise<{ answer: JournalAnswer }> {
  const { data } = await client.put("/journal/answers", { questionId, date, text });
  return data;
}

export async function deleteAnswer(questionId: string, date: string): Promise<void> {
  await client.delete("/journal/answers", { params: { questionId, date } });
}
