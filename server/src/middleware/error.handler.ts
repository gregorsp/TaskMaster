import { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: error.errors,
      },
    });
  }

  const err = error as { statusCode?: number; message?: string; code?: string };

  if (err.statusCode === 429) {
    return reply.status(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
  }

  const statusCode = err.statusCode || 500;
  // Erwartete Client-Fehler (404, 409 …) sind keine "unhandled errors" und
  // würden sonst bei jedem abgelehnten Schreibversuch das Log fluten.
  if (statusCode >= 500) console.error("Unhandled error:", error);

  return reply.status(statusCode).send({
    error: {
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "Internal server error",
    },
  });
}
