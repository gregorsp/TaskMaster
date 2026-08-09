import { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { authGuard, adminGuard } from "../../middleware/auth.hooks.js";
import { listUsers, getUser, updateUser, deleteUser } from "./users.service.js";
import { saveProfilePicture, deleteProfilePictureFiles, getProfilePictureUrl } from "../auth/profile.service.js";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { capacitySchema } from "../../lib/capacity.js";

const updateUserSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  email: z.string().email().max(255).optional(),
  displayName: z.string().min(1).max(100).optional(),
  isAdmin: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
  capacity: capacitySchema.nullable().optional(),
});

export async function usersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", { preHandler: adminGuard }, async () => {
    return listUsers();
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

    try {
      const user = await updateUser(id, input);
      if (!user) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "User not found" } });
      return user;
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 400).send({ error: { code: e.code || "UPDATE_FAILED", message: e.message } });
    }
  });

  app.delete("/:id", { preHandler: adminGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const deleted = await deleteUser(id);
      if (!deleted) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "User not found" } });
      return { ok: true };
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 400).send({ error: { code: e.code || "DELETE_FAILED", message: e.message } });
    }
  });

  app.post("/:id/profile-picture", { preHandler: adminGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const existing = db.select().from(users).where(eq(users.id, id)).get();
    if (!existing) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "User not found" } });

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: { code: "NO_FILE", message: "No file uploaded" } });
    }

    const buffer = await data.toBuffer();

    try {
      const pictureId = await saveProfilePicture(buffer, data.filename);
      deleteProfilePictureFiles(existing.profilePicture);
      db.update(users).set({ profilePicture: pictureId }).where(eq(users.id, id)).run();

      return reply.send({ profilePicture: getProfilePictureUrl(pictureId) });
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 400).send({ error: { code: e.code || "UPLOAD_FAILED", message: e.message } });
    }
  });

  app.delete("/:id/profile-picture", { preHandler: adminGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const existing = db.select({ profilePicture: users.profilePicture }).from(users).where(eq(users.id, id)).get();
    if (!existing) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "User not found" } });

    if (existing.profilePicture) {
      deleteProfilePictureFiles(existing.profilePicture);
      db.update(users).set({ profilePicture: null }).where(eq(users.id, id)).run();
    }

    return reply.send({ ok: true });
  });
}
