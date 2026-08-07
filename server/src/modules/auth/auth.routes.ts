import { FastifyInstance } from "fastify";
import { registerSchema, loginSchema } from "./auth.schema.js";
import { registerUser, authenticateUser, getUserById } from "./auth.service.js";
import { authGuard } from "../../middleware/auth.hooks.js";
import { config } from "../../config.js";

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
    const payload = request.user as { id: string };
    const user = await getUserById(payload.id);
    if (!user) {
      return reply.status(404).send({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }
    return reply.send({ user });
  });
}
