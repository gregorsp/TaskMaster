import { FastifyReply, FastifyRequest } from "fastify";

export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
  }
}

export async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  const payload = request.user as { id: string; isAdmin: boolean };
  if (!payload?.isAdmin) {
    return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Admin access required" } });
  }
}
