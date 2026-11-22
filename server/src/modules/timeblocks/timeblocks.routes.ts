import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { WEEKDAYS } from "../../lib/capacity.js";
import { taskEnergySchema } from "../tasks/tasks.schema.js";
import { listTimeBlocks, createTimeBlocks, updateTimeBlock, deleteTimeBlock } from "./timeblocks.service.js";

const minute = z.number().int().min(0).max(24 * 60);
const fields = {
  startMinute: minute,
  endMinute: minute,
  title: z.string().trim().min(1).max(100),
  contextId: z.string().nullable().optional(),
  energy: taskEnergySchema.nullable().optional(),
};
/** Ein Block kann gleich für mehrere Wochentage angelegt werden (z. B. Mo–Fr). */
const createSchema = z.object({ weekdays: z.array(z.enum(WEEKDAYS)).min(1), ...fields });
const updateSchema = z.object({ weekday: z.enum(WEEKDAYS), ...fields }).partial();

type User = { id: string };

export async function timeBlocksRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => listTimeBlocks((request.user as User).id));

  app.post("/", async (request, reply) => {
    const { weekdays, ...input } = createSchema.parse(request.body);
    return reply.status(201).send(createTimeBlocks((request.user as User).id, weekdays, input));
  });

  app.put("/:id", async (request) =>
    updateTimeBlock((request.params as { id: string }).id, (request.user as User).id, updateSchema.parse(request.body)));

  app.delete("/:id", async (request) => {
    deleteTimeBlock((request.params as { id: string }).id, (request.user as User).id);
    return { ok: true };
  });
}
