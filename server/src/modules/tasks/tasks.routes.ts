import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authGuard } from "../../middleware/auth.hooks.js";
import { isVisibleToUser } from "../../middleware/visibility.js";
import {
  listTasks, getTask, createTask, updateTask, deleteTask, listOverdueTasks,
} from "./tasks.service.js";
import { completeTask, reopenTask, getTaskEvents, addTaskComment } from "./completion.service.js";
import { createTaskSchema, updateTaskSchema } from "./tasks.schema.js";

const completeSchema = z.object({
  nextDueAt: z.string().optional(),
  comment: z.string().max(2000).optional(),
});

const commentSchema = z.object({
  content: z.string().min(1).max(2000),
});

function getPayload(request: unknown) {
  return request as { id: string; isAdmin: boolean };
}

async function checkVisibility(request: { params: { id: string }; user: { id: string; isAdmin: boolean } }, reply: unknown) {
  const r = reply as { status: (code: number) => { send: (body: unknown) => unknown } };
  if (!(await isVisibleToUser(request.params.id, request.user.id, request.user.isAdmin))) {
    return r.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
  }
  return null;
}

export async function tasksRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => {
    const p = request.user as { id: string; isAdmin: boolean };
    return listTasks(p.id, p.isAdmin, request.query as Record<string, unknown>);
  });

  app.get("/overdue", async (request) => {
    const p = request.user as { id: string; isAdmin: boolean };
    return listOverdueTasks(p.id, p.isAdmin);
  });

  app.get("/:id", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    const task = await getTask(id, p.id, p.isAdmin);
    if (!task) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return task;
  });

  app.get("/:id/events", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return getTaskEvents(id);
  });

  app.post("/:id/comment", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    const input = commentSchema.parse(request.body);
    const evt = await addTaskComment(id, p.id, input.content);
    return reply.status(201).send(evt);
  });

  app.post("/", async (request, reply) => {
    const p = request.user as { id: string };
    const input = createTaskSchema.parse(request.body);
    const task = createTask(input, p.id);
    return reply.status(201).send(task);
  });

  app.put("/:id", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    const input = updateTaskSchema.parse(request.body);
    const task = await updateTask(id, input, p.id, p.isAdmin);
    if (!task) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return task;
  });

  app.delete("/:id", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    const deleted = await deleteTask(id);
    if (!deleted) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return { ok: true };
  });

  app.post("/:id/complete", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    const input = completeSchema.parse(request.body);
    try {
      const result = await completeTask(id, p.id, input.nextDueAt, input.comment);
      return result;
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 500).send({ error: { code: e.code || "INTERNAL_ERROR", message: e.message } });
    }
  });

  app.post("/:id/reopen", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    try {
      return reopenTask(id);
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      return reply.status(e.statusCode || 500).send({ error: { code: e.code || "INTERNAL_ERROR", message: e.message } });
    }
  });
}
