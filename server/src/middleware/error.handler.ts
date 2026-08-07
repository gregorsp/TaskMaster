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

  console.error("Unhandled error:", error);
  return reply.status(err.statusCode || 500).send({
    error: {
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "Internal server error",
    },
  });
}
