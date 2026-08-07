import { FastifyInstance } from "fastify";
import { and, or, eq, isNotNull, SQL } from "drizzle-orm";
import { authGuard } from "../../middleware/auth.hooks.js";
import { visibilityFilter } from "../../middleware/visibility.js";
import { getDb } from "../../db/client.js";
import { tasks, taskAssignees } from "../../db/schema.js";
import { getOccurrences, isTaskOverdue } from "./recurrence.service.js";

export async function calendarRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => {
    const query = request.query as { from?: string; to?: string; userId?: string };
    const reqUser = request.user as { id: string; isAdmin: boolean };

    const from = query.from ? new Date(query.from) : new Date();
    const to = query.to ? new Date(query.to) : new Date(from.getFullYear(), from.getMonth() + 1, 0);
    const db = getDb();

    const targetUserId = reqUser.isAdmin && query.userId ? query.userId : reqUser.id;
    const targetIsAdmin = reqUser.isAdmin && !query.userId;

    const conditions: SQL[] = [or(isNotNull(tasks.dueAt), isNotNull(tasks.baseDate)) as SQL];
    const visFilter = visibilityFilter(targetUserId, targetIsAdmin);
    if (visFilter) conditions.push(visFilter);

    const rows = db
      .select()
      .from(tasks)
      .leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId))
      .where(and(...conditions))
      .groupBy(tasks.id)
      .all();

    const taskList = rows
      .map((r) => r.tasks)
      .filter((t) => {
        if (t.recurrenceType === "rrule" && t.baseDate) return true;
        if (!t.dueAt) return false;
        const dueDate = new Date(t.dueAt);
        return dueDate >= from && dueDate <= to;
      });

    const calendarItems: Array<{
      taskId: string;
      title: string;
      date: string;
      color: string | null;
      isCompleted: boolean;
      isOverdue: boolean;
    }> = [];

    for (const task of taskList) {
      const isOverdue = isTaskOverdue(task);
      if (task.recurrenceType === "rrule" && task.recurrenceRule && task.baseDate) {
        const occurrences = getOccurrences(task.recurrenceRule, from, to, task.baseDate);
        for (const occ of occurrences) {
          calendarItems.push({ taskId: task.id, title: task.title, date: occ.toISOString(), color: null, isCompleted: task.isCompleted, isOverdue });
        }
      } else if (task.dueAt) {
        calendarItems.push({ taskId: task.id, title: task.title, date: task.dueAt.toISOString(), color: null, isCompleted: task.isCompleted, isOverdue });
      }
    }

    return calendarItems;
  });
}
