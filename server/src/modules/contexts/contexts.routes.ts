import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { listContexts, createContext, updateContext, deleteContext } from "./contexts.service.js";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function contextsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => {
    const payload = request.user as { id: string };
    return listContexts(payload.id);
  });

  app.post("/", async (request, reply) => {
    const payload = request.user as { id: string };
    const input = createSchema.parse(request.body);
    try {
      return reply.status(201).send(createContext(input.name, payload.id, input.color));
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 400).send({ error: { code: e.code || "CREATE_FAILED", message: e.message } });
    }
  });

  app.put("/:id", async (request, reply) => {
    const payload = request.user as { id: string };
    const { id } = request.params as { id: string };
    const input = updateSchema.parse(request.body);
    try {
      const context = updateContext(id, payload.id, input.name, input.color);
      if (!context) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Context not found" } });
      return context;
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 400).send({ error: { code: e.code || "UPDATE_FAILED", message: e.message } });
    }
  });

  app.delete("/:id", async (request, reply) => {
    const payload = request.user as { id: string };
    const { id } = request.params as { id: string };
    try {
      const deleted = deleteContext(id, payload.id);
      if (!deleted) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Context not found" } });
      return { ok: true };
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 400).send({ error: { code: e.code || "DELETE_FAILED", message: e.message } });
    }
  });
}
