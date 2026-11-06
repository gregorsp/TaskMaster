import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { getAudioStats } from "./audio.service.js";
import { getMeditationStats } from "./meditation.service.js";
import { resolveRange } from "./range.js";
import { getTaskStats } from "./tasks.service.js";

const baseQuerySchema = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  range: z.enum(["7d", "30d", "90d", "week", "month", "quarter", "custom"]).default("30d"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum muss JJJJ-MM-TT sein").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum muss JJJJ-MM-TT sein").optional(),
  tz: z.string().min(1).max(64).optional(),
});

const tasksQuerySchema = baseQuerySchema.extend({
  lens: z.enum(["created", "assigned", "completed"]).default("completed"),
});

type RequestUser = { id: string; isAdmin: boolean };

function forbidAllScope(reply: FastifyReply) {
  return reply
    .status(403)
    .send({ error: { code: "FORBIDDEN", message: "Die Gesamtansicht ist Administratoren vorbehalten" } });
}

export async function statsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/tasks", async (request, reply) => {
    const user = request.user as RequestUser;
    const input = tasksQuerySchema.parse(request.query ?? {});
    if (input.scope === "all" && !user.isAdmin) return forbidAllScope(reply);

    return getTaskStats({
      scope: input.scope,
      userId: user.id,
      lens: input.lens,
      range: resolveRange(input),
    });
  });

  app.get("/meditation", async (request, reply) => {
    const user = request.user as RequestUser;
    const input = baseQuerySchema.parse(request.query ?? {});
    if (input.scope === "all" && !user.isAdmin) return forbidAllScope(reply);

    return getMeditationStats({
      scope: input.scope,
      userId: user.id,
      range: resolveRange(input),
    });
  });

  app.get("/audio", async (request, reply) => {
    const user = request.user as RequestUser;
    const input = baseQuerySchema.parse(request.query ?? {});
    if (input.scope === "all" && !user.isAdmin) return forbidAllScope(reply);

    return getAudioStats({
      scope: input.scope,
      userId: user.id,
      range: resolveRange(input),
    });
  });
}
