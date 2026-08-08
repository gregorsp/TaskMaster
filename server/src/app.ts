import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { errorHandler } from "./middleware/error.handler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { tasksRoutes } from "./modules/tasks/tasks.routes.js";
import { categoriesRoutes } from "./modules/categories/categories.routes.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { calendarRoutes } from "./modules/calendar/calendar.routes.js";
import { migrationRoutes } from "./modules/migration/migration.routes.js";
import { SCHEMA_VERSION } from "./db/version.js";
import path from "node:path";
import { existsSync } from "node:fs";

const pkg = { version: "1.0.0" };

export async function buildApp(opts?: { migrationMode?: boolean }) {
  const migrationMode = opts?.migrationMode ?? false;
  const app = Fastify({ logger: config.isDev });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    try {
      const text = typeof body === "string" ? body : body.toString();
      done(null, text ? JSON.parse(text) : {});
    } catch (err) {
      done(err as Error);
    }
  });

  await app.register(fastifyCookie);

  await app.register(fastifyCors, {
    origin: config.isDev ? ["http://localhost:5173"] : true,
    credentials: true,
  });

  await app.register(fastifyJwt, { secret: config.jwtSecret });

  app.setErrorHandler(errorHandler);

  app.get("/api/health", async () => ({
    status: "ok",
    version: pkg.version,
    schemaVersion: SCHEMA_VERSION,
    migrationRequired: migrationMode,
  }));

  await app.register(authRoutes, { prefix: "/api/auth" });

  if (migrationMode) {
    await app.register(migrationRoutes, { prefix: "/api/migration" });
  } else {
    await app.register(tasksRoutes, { prefix: "/api/tasks" });
    await app.register(categoriesRoutes, { prefix: "/api/categories" });
    await app.register(usersRoutes, { prefix: "/api/users" });
    await app.register(calendarRoutes, { prefix: "/api/calendar" });
  }

  const publicDir = path.join(process.cwd(), "public");
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
      wildcard: false,
    });

    app.setNotFoundHandler((_request, reply) => {
      reply.sendFile("index.html");
    });
  }

  return app;
}
