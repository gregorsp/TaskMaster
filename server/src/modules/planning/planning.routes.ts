import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { getPlanningData, saveDraft, discardDraft, confirmPlanning, parseCalendarDate } from "./planning.service.js";

const draftBodySchema = z.object({
  changes: z.record(z.string(), z.string().nullable()),
});

export async function planningRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => {
    const query = request.query as { from?: string; to?: string; userId?: string };
    const reqUser = request.user as { id: string; isAdmin: boolean };

    const from = query.from ? parseCalendarDate(query.from) : new Date();
    const to = query.to ? parseCalendarDate(query.to) : new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);

    const targetUserId = reqUser.isAdmin && query.userId ? query.userId : reqUser.id;
    const targetIsAdmin = reqUser.isAdmin && !query.userId;

    return getPlanningData(targetUserId, targetIsAdmin, from, to);
  });

  app.put("/draft", async (request, reply) => {
    const reqUser = request.user as { id: string };
    const body = draftBodySchema.parse(request.body);
    const draft = saveDraft(reqUser.id, body.changes);
    return reply.send(draft);
  });

  app.delete("/draft", async (request, reply) => {
    const reqUser = request.user as { id: string };
    discardDraft(reqUser.id);
    return reply.send({ ok: true });
  });

  app.post("/confirm", async (request, reply) => {
    const reqUser = request.user as { id: string };
    const result = confirmPlanning(reqUser.id);
    return reply.send(result);
  });
}
