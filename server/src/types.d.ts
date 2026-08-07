import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { id: string; isAdmin?: boolean; type?: string };
    user: { id: string; isAdmin: boolean };
  }
}
