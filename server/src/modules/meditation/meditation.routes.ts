import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import {
  addComment,
  createSession,
  deleteComment,
  deleteSession,
  getStats,
  listSessions,
  updateSession,
} from "./meditation.service.js";

const concentration = z.number().int().min(1).max(5).nullable().optional();

const createSchema = z.object({
  startedAt: z.string().datetime().optional(),
  plannedDurationSec: z.number().int().min(0).max(24 * 60 * 60).nullable().optional(),
  actualDurationSec: z.number().int().min(0).max(24 * 60 * 60).optional(),
  note: z.string().max(20_000).nullable().optional(),
  concentration,
});

const updateSchema = z.object({
  endedAt: z.string().datetime().nullable().optional(),
  plannedDurationSec: z.number().int().min(0).max(24 * 60 * 60).nullable().optional(),
  actualDurationSec: z.number().int().min(0).max(24 * 60 * 60).optional(),
  note: z.string().max(20_000).nullable().optional(),
  concentration,
});

const commentSchema = z.object({ text: z.string().trim().min(1).max(20_000) });

export async function meditationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/sessions", async (request) => {
    const user = request.user as { id: string };
    const limitRaw = (request.query as { limit?: string } | undefined)?.limit;
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 200);
    return { sessions: listSessions(user.id, limit), stats: getStats(user.id) };
  });

  app.post("/sessions", async (request, reply) => {
    const user = request.user as { id: string };
    const input = createSchema.parse(request.body ?? {});
    const session = createSession(user.id, {
      startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
      plannedDurationSec: input.plannedDurationSec ?? null,
      actualDurationSec: input.actualDurationSec ?? 0,
      note: input.note ?? null,
      concentration: input.concentration ?? null,
    });
    return reply.status(201).send(session);
  });

  app.patch("/sessions/:id", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const input = updateSchema.parse(request.body ?? {});
    const session = updateSession(user.id, id, {
      endedAt: input.endedAt === undefined ? undefined : input.endedAt ? new Date(input.endedAt) : null,
      plannedDurationSec: input.plannedDurationSec,
      actualDurationSec: input.actualDurationSec,
      note: input.note,
      concentration: input.concentration,
    });
    if (!session) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Session nicht gefunden" } });
    }
    return session;
  });

  app.delete("/sessions/:id", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    if (!deleteSession(user.id, id)) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Session nicht gefunden" } });
    }
    return { ok: true };
  });

  app.post("/sessions/:id/comments", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const input = commentSchema.parse(request.body ?? {});
    const comment = addComment(user.id, id, input.text);
    if (!comment) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Session nicht gefunden" } });
    }
    return reply.status(201).send(comment);
  });

  app.delete("/sessions/:id/comments/:commentId", async (request, reply) => {
    const user = request.user as { id: string };
    const { id, commentId } = request.params as { id: string; commentId: string };
    if (!deleteComment(user.id, id, commentId)) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Kommentar nicht gefunden" } });
    }
    return { ok: true };
  });

  app.get("/stats", async (request) => {
    const user = request.user as { id: string };
    return getStats(user.id);
  });
}
