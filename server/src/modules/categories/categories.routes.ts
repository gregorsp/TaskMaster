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

  app.get("/", async () => {
    return listCategories();
  });

  app.post("/", async (request, reply) => {
    const payload = request.user as { id: string };
    const input = createSchema.parse(request.body);
    const cat = createCategory(input.name, payload.id, input.color);
    return reply.status(201).send(cat);
  });

  app.put("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateSchema.parse(request.body);
    const cat = updateCategory(id, input.name, input.color);
    if (!cat) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Category not found" } });
    return cat;
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = deleteCategory(id);
    if (!deleted) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Category not found" } });
    return { ok: true };
  });
}
