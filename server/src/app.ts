import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { config } from "./config.js";
import { errorHandler } from "./middleware/error.handler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { tasksRoutes } from "./modules/tasks/tasks.routes.js";
import { categoriesRoutes } from "./modules/categories/categories.routes.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { calendarRoutes } from "./modules/calendar/calendar.routes.js";
import { planningRoutes } from "./modules/planning/planning.routes.js";
import { dailyRoutes } from "./modules/daily/daily.routes.js";
import { notesRoutes } from "./modules/notes/notes.routes.js";
import { journalRoutes } from "./modules/journal/journal.routes.js";
import { meditationRoutes } from "./modules/meditation/meditation.routes.js";
import { recordingsRoutes } from "./modules/recordings/recordings.routes.js";
import { recordingAudioRoutes } from "./modules/recordings/recordings.audio.routes.js";
import { transcriptionRoutes } from "./modules/transcription/transcription.routes.js";
import { migrationRoutes } from "./modules/migration/migration.routes.js";
import { SCHEMA_VERSION } from "./db/version.js";
import path from "node:path";
import { existsSync, createReadStream } from "node:fs";

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

  // Audio-Chunks kommen als rohe Bytes (kein Multipart) und bleiben klein:
  // ein 10-s-Chunk bei 128 kbit/s liegt bei ~160 kB.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 2 * 1024 * 1024 },
    (_request, body, done) => {
      done(null, body);
    }
  );

  await app.register(fastifyCookie);

  await app.register(fastifyCors, {
    origin: config.isDev ? ["http://localhost:5173"] : true,
    credentials: true,
  });

  await app.register(fastifyJwt, { secret: config.jwtSecret });

  await app.register(fastifyMultipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  app.setErrorHandler(errorHandler);

  // Cross-Origin-Isolation: Voraussetzung für SharedArrayBuffer und damit für
  // WASM-Threads in der Transkription. Alle Ressourcen der App sind same-origin;
  // das Modell kommt per CORS-Fetch von Hugging Face (dort erlaubt).
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Embedder-Policy", "require-corp");
    return payload;
  });

  app.get("/api/health", async () => ({
    status: "ok",
    version: pkg.version,
    schemaVersion: SCHEMA_VERSION,
    migrationRequired: migrationMode,
  }));

  app.get("/api/avatars/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const filePath = path.join(config.avatarsDir, filename);

    if (!filePath.startsWith(config.avatarsDir) || filename.includes("..")) {
      return reply.status(400).send({ error: { code: "INVALID_PATH", message: "Invalid filename" } });
    }

    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Avatar not found" } });
    }

    const stream = createReadStream(filePath);
    const ext = path.extname(filename).replace(".", "");
    const mimeTypes: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    reply.header("Content-Type", contentType);
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(stream);
  });

  await app.register(authRoutes, { prefix: "/api/auth" });

  if (migrationMode) {
    await app.register(migrationRoutes, { prefix: "/api/migration" });
  } else {
    await app.register(tasksRoutes, { prefix: "/api/tasks" });
    await app.register(categoriesRoutes, { prefix: "/api/categories" });
    await app.register(usersRoutes, { prefix: "/api/users" });
    await app.register(calendarRoutes, { prefix: "/api/calendar" });
    await app.register(planningRoutes, { prefix: "/api/planning" });
    await app.register(dailyRoutes, { prefix: "/api/daily" });
    await app.register(notesRoutes, { prefix: "/api/notes" });
    await app.register(journalRoutes, { prefix: "/api/journal" });
    await app.register(meditationRoutes, { prefix: "/api/meditation" });
    await app.register(recordingsRoutes, { prefix: "/api/recordings" });
    await app.register(recordingAudioRoutes, { prefix: "/api/recordings" });
    await app.register(transcriptionRoutes, { prefix: "/api/transcription" });
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
