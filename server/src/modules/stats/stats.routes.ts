import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { getAudioStats } from "./audio.service.js";

const audioQuerySchema = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  range: z.coerce
    .number()
    .int()
    .refine((value) => [7, 30, 90].includes(value), { message: "Erlaubt sind 7, 30 oder 90 Tage" })
    .default(30),
});

export async function statsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/audio", async (request, reply) => {
    const user = request.user as { id: string; isAdmin: boolean };
    const input = audioQuerySchema.parse(request.query ?? {});
    if (input.scope === "all" && !user.isAdmin) {
      return reply
        .status(403)
        .send({ error: { code: "FORBIDDEN", message: "Die Gesamtansicht ist Administratoren vorbehalten" } });
    }

    return getAudioStats({ scope: input.scope, userId: user.id, days: input.range });
  });
}
