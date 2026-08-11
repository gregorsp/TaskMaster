import { FastifyInstance } from "fastify";
import { authGuard } from "../../middleware/auth.hooks.js";
import { getDailyData } from "./daily.service.js";

export async function dailyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const q = request.query as Record<string, unknown> | undefined;
    const dateStr = q && typeof q.date === "string" ? q.date : undefined;

    let date: Date;
    if (dateStr) {
      date = new Date(`${dateStr}T00:00:00`);
      if (isNaN(date.getTime())) {
        return reply.status(400).send({ error: { code: "INVALID_DATE", message: "Invalid date format (expected YYYY-MM-DD)" } });
      }
    } else {
      const now = new Date();
      date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    return getDailyData(p.id, p.isAdmin, date);
  });
}
