import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { listBoards, createBoard, updateBoard, deleteBoard } from "./mindmaps.service.js";

/** Knoten/Kanten bleiben für den Server undurchsichtig, sind aber in Anzahl begrenzt. */
const content = {
  nodes: z.array(z.record(z.unknown())).max(500),
  extraEdges: z.array(z.record(z.unknown())).max(1000),
};
const createSchema = z.object({ title: z.string().trim().min(1).max(200), ...content });
const updateSchema = createSchema.partial();

type User = { id: string };

export async function mindmapsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => listBoards((request.user as User).id));

  app.post("/", async (request, reply) =>
    reply.status(201).send(createBoard((request.user as User).id, createSchema.parse(request.body))));

  app.put("/:id", async (request) =>
    updateBoard((request.params as { id: string }).id, (request.user as User).id, updateSchema.parse(request.body)));

  app.delete("/:id", async (request) => {
    deleteBoard((request.params as { id: string }).id, (request.user as User).id);
    return { ok: true };
  });
}
