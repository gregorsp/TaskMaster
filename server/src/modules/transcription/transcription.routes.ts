import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { claimJob, countOpenJobs, listJobs, resetJob, updateJob } from "../recordings/recordings.service.js";

const claimSchema = z.object({
  deviceId: z.string().trim().min(1).max(100),
});

const updateSchema = z.object({
  status: z.enum(["running", "failed"]),
  progressMs: z.number().int().min(0).optional(),
  error: z.string().max(1000).optional(),
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
    const job = updateJob(user.id, id, input);
    if (!job) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Job nicht gefunden" } });
    }
    return job;
  });
}
