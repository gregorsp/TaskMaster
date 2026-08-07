import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard, adminGuard } from "../../middleware/auth.hooks.js";
import { listUsers, getUser, updateUser, deleteUser } from "./users.service.js";
import { getDbMigrationStatus, migrateDatabaseWithBackup } from "../../db/bootstrap.js";

const updateUserSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  email: z.string().email().max(255).optional(),
  displayName: z.string().min(1).max(100).optional(),
  isAdmin: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
});

export async function usersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", { preHandler: adminGuard }, async () => {
    return listUsers();
  });

  app.get("/bootstrap/db-migration", { preHandler: adminGuard }, async () => {
    return getDbMigrationStatus();
  });

  app.post("/bootstrap/db-migration", { preHandler: adminGuard }, async () => {
    return migrateDatabaseWithBackup();
  });

  app.get("/picker", async () => {
    const all = listUsers();
    return all.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName }));
  });

  app.get("/:id", { preHandler: adminGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = getUser(id);
    if (!user) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "User not found" } });
    return user;
  });

  app.put("/:id", { preHandler: adminGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = updateUserSchema.parse(request.body);
    const user = updateUser(id, input);
    if (!user) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "User not found" } });
    return user;
  });

  app.delete("/:id", { preHandler: adminGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteUser(id);
    if (!deleted) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "User not found" } });
    return { ok: true };
  });
}
