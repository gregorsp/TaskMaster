import { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminGuard, authGuard } from "../../middleware/auth.hooks.js";
import { config } from "../../config.js";
import {
  STALE_AFTER_MS,
  claimJob,
  countOpenJobs,
  listJobs,
  listServerQueue,
  resetJob,
  updateJob,
} from "../recordings/recordings.service.js";
import { MODEL_TOTAL_BYTES, modelStatus } from "./server/modelStore.js";
import { readLastRun, readNextRun, readRunHistory } from "./server/runlog.js";
import { isModelLoaded, isTranscriptionRunActive, runTranscriptionBatch } from "./server/runner.js";

const claimSchema = z.object({
  deviceId: z.string().trim().min(1).max(100),
});

const updateSchema = z.object({
  status: z.enum(["running", "failed"]),
  progressMs: z.number().int().min(0).optional(),
  error: z.string().max(1000).optional(),
  /** Revision aus dem Claim. Fehlt sie, wird nicht geprüft (Altclients). */
  epoch: z.number().int().min(0).optional(),
});

export async function transcriptionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/jobs", async (request) => {
    const user = request.user as { id: string };
    return { jobs: listJobs(user.id), open: countOpenJobs(user.id) };
  });

  app.post("/jobs/claim", async (request, reply) => {
    const user = request.user as { id: string };
    const input = claimSchema.parse(request.body ?? {});
    const claimed = claimJob(user.id, input.deviceId);
    if (!claimed) return reply.status(204).send();
    return reply.status(201).send(claimed);
  });

  app.post("/jobs/:id/retry", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const job = resetJob(user.id, id);
    if (!job) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Job nicht gefunden" } });
    }
    return job;
  });

  app.patch("/jobs/:id", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const input = updateSchema.parse(request.body ?? {});
    const job = updateJob(user.id, id, input, input.epoch);
    if (!job) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Job nicht gefunden" } });
    }
    return job;
  });

  // -------------------------------------------------------------------------
  // Status und manueller Start des nächtlichen Laufs (nur Admin)
  // -------------------------------------------------------------------------

  app.get("/server", { preHandler: adminGuard }, async () => {
    const queue = listServerQueue();
    const counts = { pending: 0, running: 0, failed: 0 };
    for (const entry of queue) {
      if (entry.job.status === "pending") counts.pending += 1;
      else if (entry.job.status === "failed") counts.failed += 1;
      else counts.running += 1;
    }

    return {
      enabled: config.transcribeServer,
      running: isTranscriptionRunActive(),
      schedule: {
        at: config.transcribeAt,
        timeZone: config.transcriptionTz,
        nextRunAt: readNextRun(),
        catchUpUntil: "06:00",
      },
      queue: counts,
      staleAfterMs: STALE_AFTER_MS,
      model: {
        ...modelStatus(),
        totalBytes: MODEL_TOTAL_BYTES,
        loaded: isModelLoaded(),
      },
      lastRun: readLastRun(),
      runs: readRunHistory(),
      jobs: queue.slice(0, 50).map((entry) => ({
        id: entry.job.id,
        recordingId: entry.recording.id,
        status: entry.job.status,
        attempts: entry.job.attempts,
        progressMs: entry.job.progressMs,
        error: entry.job.error,
        updatedAt: entry.job.updatedAt,
        durationMs: entry.recording.durationMs,
        mimeType: entry.recording.mimeType,
      })),
    };
  });

  app.post("/server/run", { preHandler: adminGuard }, async (request, reply) => {
    if (!config.transcribeServer) {
      return reply.status(409).send({
        error: {
          code: "TRANSCRIPTION_DISABLED",
          message: "Server-Transkription ist aus (TRANSCRIBE_SERVER=true setzen)",
        },
      });
    }
    if (isTranscriptionRunActive()) {
      return reply.status(409).send({
        error: { code: "RUN_ACTIVE", message: "Es läuft bereits eine Transkription" },
      });
    }

    // Bewusst ohne await: der Lauf dauert Minuten, die Antwort geht sofort raus.
    void runTranscriptionBatch({
      triggeredBy: "admin",
      log: (message) => request.log.info(`[transcription] ${message}`),
    }).catch((error) => request.log.error(error));

    return reply.status(202).send({ started: true });
  });
}
