import { FastifyInstance } from "fastify";
import { authGuard } from "../../middleware/auth.hooks.js";
import { isVisibleToUser } from "../../middleware/visibility.js";
import {
  listTasks, getTask, createTask, updateTask, deleteTask,
  getSubtasks, getSiblings, getTaskLinks, addTaskLink, removeTaskLink,
} from "./tasks.service.js";
import { completeTask, reopenTask, getTaskEvents, addTaskComment } from "./completion.service.js";
import { createTaskSchema, updateTaskSchema, completeTaskSchema, addLinkSchema, commentSchema } from "./tasks.schema.js";

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
    const evt = addTaskComment(id, p.id, input.content);
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
    const result = await deleteTask(id);
    if (result === false) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    if (typeof result === "object" && result.blocked) {
      return reply.status(409).send({ error: { code: result.code, message: "Task has open subtasks" } });
    }
    return { ok: true };
  });

  app.post("/:id/complete", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    const input = completeTaskSchema.parse(request.body);
    try {
      const result = await completeTask(id, p.id, input.nextDueAt, input.comment, input.force);
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

  app.get("/:id/subtasks", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return getSubtasks(id);
  });

  app.get("/:id/siblings", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return getSiblings(id);
  });

  app.get("/:id/links", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return getTaskLinks(id);
  });

  app.post("/:id/links", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    const input = addLinkSchema.parse(request.body);
    if (input.linkedTaskId === id) {
      return reply.status(400).send({ error: { code: "INVALID_LINK", message: "Cannot link a task to itself" } });
    }
    if (!(await isVisibleToUser(input.linkedTaskId, p.id, p.isAdmin))) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Linked task not found" } });
    }
    return addTaskLink(id, input.linkedTaskId);
  });

  app.delete("/:id/links/:linkedTaskId", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id, linkedTaskId } = request.params as { id: string; linkedTaskId: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return removeTaskLink(id, linkedTaskId);
  });
}
