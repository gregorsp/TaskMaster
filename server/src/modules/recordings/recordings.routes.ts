import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import {
  appendChunk,
  completeRecording,
  createRecording,
  getOwnedRecording,
  replaceSegments,
} from "./recordings.service.js";
import { PLAYBACK_TOKEN_TTL, createPlaybackToken } from "./playback.token.js";

const completeSchema = z.object({
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  byteSize: z.number().int().min(0).optional(),
});

const createRecordingSchema = z.object({
  ownerType: z.enum(["note", "journal_entry", "journal_answer", "meditation_session"]),
  ownerId: z.string().uuid(),
  mimeType: z.string().min(1).max(120),
  startedAt: z.string().datetime().optional(),
});

const segmentsSchema = z.object({
  segments: z
    .array(
      z
        .object({
          startMs: z.number().int().min(0),
          endMs: z.number().int().min(0),
          text: z.string().max(5000),
        })
        .refine((segment) => segment.endMs >= segment.startMs, {
          message: "Segment endet vor seinem Anfang",
        })
    )
    .max(5000),
  /** Revision aus dem Claim. Fehlt sie, wird nicht geprüft (Altclients). */
  epoch: z.number().int().min(0).optional(),
});

export async function recordingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.post("/", async (request, reply) => {
    const user = request.user as { id: string };
    const input = createRecordingSchema.parse(request.body ?? {});
    const recording = createRecording(user.id, input.ownerType, input.ownerId, {
      mimeType: input.mimeType,
      startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
    });
    return reply.status(201).send(recording);
  });

  app.put("/:id/chunks", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const seqRaw = (request.query as { seq?: string } | undefined)?.seq;
    const seq = Number(seqRaw);

    if (!Number.isInteger(seq) || seq < 0) {
      return reply.status(400).send({
        error: { code: "INVALID_SEQ", message: "seq muss eine nicht-negative Ganzzahl sein" },
      });
    }
    if (!Buffer.isBuffer(request.body)) {
      return reply.status(400).send({
        error: { code: "INVALID_BODY", message: "Erwartet application/octet-stream" },
      });
    }

    const result = appendChunk(user.id, id, seq, request.body);
    if (result.status === "gap") {
      return reply.status(409).send({
        error: {
          code: "CHUNK_OUT_OF_ORDER",
          message: "Chunk passt nicht an das Ende der Aufnahme",
          expectedSeq: result.expectedSeq,
        },
      });
    }

    return reply.status(result.status === "accepted" ? 201 : 200).send({
      ok: true,
      duplicate: result.status === "duplicate",
      chunkCount: result.chunkCount,
      byteSize: result.byteSize,
    });
  });

  app.post("/:id/complete", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const input = completeSchema.parse(request.body ?? {});
    return completeRecording(user.id, id, input.durationMs, input.byteSize);
  });

  app.put("/:id/segments", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const input = segmentsSchema.parse(request.body ?? {});
    const segments = replaceSegments(user.id, id, input.segments, input.epoch);
    return { segments };
  });

  app.post("/:id/playback-token", async (request, reply) => {
    const user = request.user as { id: string };
    const { id } = request.params as { id: string };
    const recording = getOwnedRecording(user.id, id);
    if (!recording) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Aufnahme nicht gefunden" } });
    }

    const token = createPlaybackToken(id, user.id);
    return {
      url: `/api/recordings/${id}/audio?token=${token}`,
      expiresAt: Date.now() + PLAYBACK_TOKEN_TTL,
    };
  });
}
