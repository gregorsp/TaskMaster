import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import {
  archiveQuestion,
  assertIsoDate,
  createEntry,
  createQuestion,
  deleteAnswer,
  deleteEntry,
  getDay,
  getQuestionHistory,
  listQuestions,
  setAnswer,
  updateEntry,
  updateQuestion,
} from "./journal.service.js";

const questionCreateSchema = z.object({ text: z.string().trim().min(1).max(300) });

const questionUpdateSchema = z.object({
  text: z.string().trim().min(1).max(300).optional(),
  position: z.number().int().min(0).optional(),
});

const entryCreateSchema = z.object({
  date: z.string(),
  text: z.string().max(20_000).default(""),
});

const entryUpdateSchema = z.object({ text: z.string().max(20_000) });

const answerSchema = z.object({
  questionId: z.string().uuid(),
  date: z.string(),
  text: z.string().max(20_000),
});

export async function journalRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/questions", async (request) => {
    const user = request.user as { id: string };
    return { questions: listQuestions(user.id) };
  });

  app.post("/questions", async (request, reply) => {
    const user = request.user as { id: string };
    const input = questionCreateSchema.parse(request.body ?? {});
    return reply.status(201).send(createQuestion(user.id, input.text));
  });

  app.patch("/questions/:id", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const patch = questionUpdateSchema.parse(request.body ?? {});
    const question = updateQuestion(user.id, id, patch);
    if (!question) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Frage nicht gefunden" } });
    }
    return question;
  });

  app.delete("/questions/:id", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    if (!archiveQuestion(user.id, id)) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Frage nicht gefunden" } });
    }
    return { ok: true };
  });

  app.get("/questions/:id/history", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const history = getQuestionHistory(user.id, id);
    if (!history) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Frage nicht gefunden" } });
    }
    return history;
  });

  app.get("/day", async (request, reply) => {
    const user = request.user as { id: string };
    const date = assertIsoDate(String((request.query as { date?: string } | undefined)?.date ?? ""));
    return getDay(user.id, date);
  });

  app.post("/entries", async (request, reply) => {
    const user = request.user as { id: string };
    const input = entryCreateSchema.parse(request.body ?? {});
    const date = assertIsoDate(input.date);
    return reply.status(201).send(createEntry(user.id, date, input.text));
  });

  app.patch("/entries/:id", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const input = entryUpdateSchema.parse(request.body ?? {});
    const entry = updateEntry(user.id, id, input.text);
    if (!entry) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Eintrag nicht gefunden" } });
    }
    return entry;
  });

  app.delete("/entries/:id", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    if (!deleteEntry(user.id, id)) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Eintrag nicht gefunden" } });
    }
    return { ok: true };
  });

  app.put("/answers", async (request) => {
    const user = request.user as { id: string };
    const input = answerSchema.parse(request.body ?? {});
    const date = assertIsoDate(input.date);
    return { answer: setAnswer(user.id, input.questionId, date, input.text) };
  });

  app.delete("/answers", async (request, reply) => {
    const user = request.user as { id: string };
    const query = request.query as { questionId?: string; date?: string } | undefined;
    const date = assertIsoDate(String(query?.date ?? ""));
    if (!deleteAnswer(user.id, String(query?.questionId ?? ""), date)) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Antwort nicht gefunden" } });
    }
    return { ok: true };
  });
}
