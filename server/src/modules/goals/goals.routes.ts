import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { listGoals, createGoal, updateGoal, deleteGoal } from "./goals.service.js";

const fields = {
  description: z.string().max(2000).nullable().optional(),
  targetDate: z.string().nullable().optional(),
  achieved: z.boolean().optional(),
};
const createSchema = z.object({ title: z.string().trim().min(1).max(200), ...fields });
const updateSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), ...fields });

type User = { id: string };

export async function goalsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => listGoals((request.user as User).id));

  app.post("/", async (request, reply) =>
    reply.status(201).send(createGoal((request.user as User).id, createSchema.parse(request.body))));

  app.put("/:id", async (request) =>
    updateGoal((request.params as { id: string }).id, (request.user as User).id, updateSchema.parse(request.body)));

  app.delete("/:id", async (request) => {
    deleteGoal((request.params as { id: string }).id, (request.user as User).id);
    return { ok: true };
  });
}
