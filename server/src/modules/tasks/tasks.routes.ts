import { FastifyInstance } from "fastify";
import { authGuard } from "../../middleware/auth.hooks.js";
import { isVisibleToUser } from "../../middleware/visibility.js";
import {
  listTasks, getTask, createTask, updateTask, deleteTask,
  getSubtasks, getSiblings, getTaskLinks, addTaskLink, removeTaskLink,
  getTaskOccurrences, createTaskOccurrence, deleteTaskOccurrence, getUpcomingOccurrences,
} from "./tasks.service.js";
import { completeTask, reopenTask, getTaskEvents, addTaskComment } from "./completion.service.js";
import { createTaskSchema, updateTaskSchema, completeTaskSchema, addLinkSchema, commentSchema, reopenTaskSchema } from "./tasks.schema.js";

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
    if ("blocked" in task && task.blocked) {
      return reply.status(409).send({ error: { code: task.code, message: "Planned occurrences will be deleted", count: (task as { count: number }).count } });
    }
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
      const result = await completeTask(id, p.id, input.nextDueAt, input.comment, input.force, input.cascade, input.occurrenceDate, input.recurringCompletions);
      return result;
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string; openCount?: number };
      return reply.status(e.statusCode || 500).send({ error: { code: e.code || "INTERNAL_ERROR", message: e.message, openCount: e.openCount } });
    }
  });

  app.post("/:id/reopen", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    try {
      const input = reopenTaskSchema.parse(request.body ?? {});
      return reopenTask(id, input.occurrenceDate);
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

  app.get("/:id/occurrences", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return getTaskOccurrences(id);
  });

  app.get("/:id/upcoming-occurrences", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    const q = request.query as Record<string, unknown> | undefined;
    const count = q && typeof q.count === "string" ? parseInt(q.count, 10) || 3 : 3;
    const showPast = q && (q.showPast === "true" || q.showPast === true);
    return getUpcomingOccurrences(id, count, showPast);
  });

  app.post("/:id/occurrences", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id } = request.params as { id: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    const body = request.body as { occurrenceDate?: string; plannedDate?: string | null };
    const occurrenceDate = body?.occurrenceDate;
    if (!occurrenceDate) {
      return reply.status(400).send({ error: { code: "MISSING_OCCURRENCE_DATE", message: "occurrenceDate is required" } });
    }
    const result = createTaskOccurrence(id, occurrenceDate, body.plannedDate ?? null);
    return reply.status(201).send(result);
  });

  app.delete("/:id/occurrences/:occurrenceId", async (request, reply) => {
    const p = request.user as { id: string; isAdmin: boolean };
    const { id, occurrenceId } = request.params as { id: string; occurrenceId: string };
    if (!(await isVisibleToUser(id, p.id, p.isAdmin)))
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return deleteTaskOccurrence(occurrenceId);
  });
}
