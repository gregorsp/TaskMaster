import { FastifyInstance } from "fastify";
import { registerSchema, loginSchema } from "./auth.schema.js";
import {
  registerUser, authenticateUser, getUserById, updateCurrentUser, changePassword,
  getCurrentUserCapacity, updateCurrentUserCapacity,
} from "./auth.service.js";
import { authGuard } from "../../middleware/auth.hooks.js";
import { config } from "../../config.js";
import { z } from "zod";
import { saveProfilePicture, deleteProfilePictureFiles, getProfilePictureUrl } from "./profile.service.js";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { capacitySchema } from "../../lib/capacity.js";

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email().max(255).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const updateCapacitySchema = z.object({
  capacity: capacitySchema.nullable(),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const user = await registerUser(input);
    return reply.status(201).send({ user });
  });

  app.post("/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await authenticateUser(input.email, input.password);

    const accessToken = app.jwt.sign({ id: user.id, isAdmin: user.isAdmin }, { expiresIn: config.accessTtl });
    const refreshToken = app.jwt.sign({ id: user.id, type: "refresh" }, { expiresIn: config.refreshTtl });

    reply.setCookie("refreshToken", refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProd,
      path: "/api/auth/refresh",
      maxAge: 7 * 24 * 60 * 60,
    });

    return reply.send({ accessToken, user });
  });

  app.post("/refresh", async (request, reply) => {
    const token = request.cookies?.refreshToken;
    if (!token) {
      return reply.status(401).send({ error: { code: "NO_REFRESH_TOKEN", message: "No refresh token provided" } });
    }

    try {
      const payload = await app.jwt.verify<{ id: string; type: string }>(token);
      if (payload.type !== "refresh") {
        return reply.status(401).send({ error: { code: "INVALID_REFRESH_TOKEN", message: "Invalid refresh token" } });
      }

      const user = await getUserById(payload.id);
      if (!user) {
        return reply.status(401).send({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
      }

      const accessToken = app.jwt.sign({ id: user.id, isAdmin: user.isAdmin }, { expiresIn: config.accessTtl });

      return reply.send({ accessToken, user });
    } catch {
      return reply.status(401).send({ error: { code: "INVALID_REFRESH_TOKEN", message: "Invalid refresh token" } });
    }
  });

  app.post("/logout", { preHandler: authGuard }, async (_request, reply) => {
    reply.clearCookie("refreshToken", { path: "/api/auth/refresh" });
    return reply.send({ ok: true });
  });

  app.get("/me", { preHandler: authGuard }, async (request, reply) => {
    const { user: authUser } = request as { user: { id: string; isAdmin: boolean } };
    const user = await getUserById(authUser.id);
    if (!user) {
      return reply.status(404).send({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }
    return reply.send({ user });
  });

  app.put("/me", { preHandler: authGuard }, async (request, reply) => {
    const { user: authUser } = request as { user: { id: string; isAdmin: boolean } };
    const input = updateProfileSchema.parse(request.body);

    try {
      const user = await updateCurrentUser(authUser.id, input);
      return reply.send({ user });
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 400).send({ error: { code: e.code || "UPDATE_FAILED", message: e.message } });
    }
  });

  app.put("/me/password", { preHandler: authGuard }, async (request, reply) => {
    const { user: authUser } = request as { user: { id: string; isAdmin: boolean } };
    const input = changePasswordSchema.parse(request.body);

    try {
      await changePassword(authUser.id, input.currentPassword, input.newPassword);
      return reply.send({ ok: true });
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 400).send({ error: { code: e.code || "PASSWORD_CHANGE_FAILED", message: e.message } });
    }
  });

  app.get("/me/capacity", { preHandler: authGuard }, async (request, reply) => {
    const { user: authUser } = request as { user: { id: string; isAdmin: boolean } };
    try {
      return reply.send({ capacity: getCurrentUserCapacity(authUser.id) });
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 500).send({ error: { code: e.code || "INTERNAL_ERROR", message: e.message } });
    }
  });

  app.put("/me/capacity", { preHandler: authGuard }, async (request, reply) => {
    const { user: authUser } = request as { user: { id: string; isAdmin: boolean } };
    const input = updateCapacitySchema.parse(request.body);

    try {
      return reply.send({ capacity: updateCurrentUserCapacity(authUser.id, input.capacity) });
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 500).send({ error: { code: e.code || "UPDATE_FAILED", message: e.message } });
    }
  });

  app.post("/me/profile-picture", { preHandler: authGuard }, async (request, reply) => {
    const { user: authUser } = request as { user: { id: string; isAdmin: boolean } };
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: { code: "NO_FILE", message: "No file uploaded" } });
    }

    const buffer = await data.toBuffer();

    try {
      const db = getDb();
      const currentUser = db.select({ profilePicture: users.profilePicture }).from(users).where(eq(users.id, authUser.id)).get();

      const pictureId = await saveProfilePicture(buffer, data.filename);

      deleteProfilePictureFiles(currentUser?.profilePicture ?? null);

      db.update(users).set({ profilePicture: pictureId }).where(eq(users.id, authUser.id)).run();

      return reply.send({ profilePicture: getProfilePictureUrl(pictureId) });
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 400).send({ error: { code: e.code || "UPLOAD_FAILED", message: e.message } });
    }
  });

  app.delete("/me/profile-picture", { preHandler: authGuard }, async (request, reply) => {
    const { user: authUser } = request as { user: { id: string; isAdmin: boolean } };
    const db = getDb();

    const currentUser = db.select({ profilePicture: users.profilePicture }).from(users).where(eq(users.id, authUser.id)).get();

    if (!currentUser?.profilePicture) {
      return reply.send({ ok: true });
    }

    deleteProfilePictureFiles(currentUser.profilePicture);
    db.update(users).set({ profilePicture: null }).where(eq(users.id, authUser.id)).run();

    return reply.send({ ok: true });
  });
}
