import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { listCategories, createCategory, updateCategory, deleteCategory } from "./categories.service.js";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function categoriesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => {
    const payload = request.user as { id: string };
    return listCategories(payload.id);
  });

  app.post("/", async (request, reply) => {
    const payload = request.user as { id: string };
    const input = createSchema.parse(request.body);
    try {
      const cat = createCategory(input.name, payload.id, input.color);
      return reply.status(201).send(cat);
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
      const cat = updateCategory(id, payload.id, input.name, input.color);
      if (!cat) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Category not found" } });
      return cat;
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 400).send({ error: { code: e.code || "UPDATE_FAILED", message: e.message } });
    }
  });

  app.delete("/:id", async (request, reply) => {
    const payload = request.user as { id: string };
    const { id } = request.params as { id: string };
    try {
      const deleted = deleteCategory(id, payload.id);
      if (!deleted) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Category not found" } });
      return { ok: true };
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode ?? 400).send({ error: { code: e.code || "DELETE_FAILED", message: e.message } });
    }
  });
}
