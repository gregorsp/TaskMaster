import { FastifyInstance } from "fastify";
import { and, or, eq, isNotNull, SQL } from "drizzle-orm";
import { authGuard } from "../../middleware/auth.hooks.js";
import { visibilityFilter } from "../../middleware/visibility.js";
import { getDb } from "../../db/client.js";
import { tasks, taskAssignees } from "../../db/schema.js";
import { getOccurrences, getEffectiveDueAt, isTaskOverdue } from "./recurrence.service.js";

interface CalendarItem {
  taskId: string;
  title: string;
  date: string;
  color: string | null;
  isCompleted: boolean;
  isOverdue: boolean;
  plannedDate: string | null;
  pomodoros: number | null;
  type: "due" | "planned";
}

export async function calendarRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/", async (request) => {
    const query = request.query as { from?: string; to?: string; userId?: string; mode?: string };
    const reqUser = request.user as { id: string; isAdmin: boolean };

    const mode = (query.mode as string) || "both";
    const showDue = mode === "due" || mode === "both";
    const showPlanned = mode === "planned" || mode === "both";

    const from = query.from ? new Date(query.from) : new Date();
    const to = query.to ? new Date(query.to) : new Date(from.getFullYear(), from.getMonth() + 1, 0);
    const db = getDb();

    const targetUserId = reqUser.isAdmin && query.userId ? query.userId : reqUser.id;
    const targetIsAdmin = reqUser.isAdmin && !query.userId;

    const dateConditions: SQL[] = [];
    if (showDue) {
      dateConditions.push(or(isNotNull(tasks.dueAt), isNotNull(tasks.baseDate)) as SQL);
    }
    if (showPlanned) {
      dateConditions.push(isNotNull(tasks.plannedDate) as SQL);
    }
    const conditions: SQL[] = [or(...dateConditions) as SQL];
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
        if (showDue && t.recurrenceType === "rrule" && t.baseDate) return true;
        if (showDue && t.dueAt) {
          const dueDate = new Date(t.dueAt);
          return dueDate >= from && dueDate <= to;
        }
        if (showPlanned && t.plannedDate) {
          const pd = new Date(t.plannedDate);
          return pd >= from && pd <= to;
        }
        return false;
      });

    const calendarItems: CalendarItem[] = [];
    const formatTask = (t: typeof tasks.$inferSelect, date: Date, type: "due" | "planned"): CalendarItem => ({
      taskId: t.id,
      title: t.title,
      date: date.toISOString(),
      color: null,
      isCompleted: t.isCompleted,
      isOverdue: isTaskOverdue(t),
      plannedDate: t.plannedDate?.toISOString() ?? null,
      pomodoros: t.pomodoros ?? null,
      type,
    });

    for (const task of taskList) {
      const isOverdue = isTaskOverdue(task);

      if (showDue && task.recurrenceType === "rrule" && task.recurrenceRule && task.baseDate) {
        const occurrences = getOccurrences(task.recurrenceRule, from, to, task.baseDate);
        for (const occ of occurrences) {
          calendarItems.push(formatTask(task, occ, "due"));
        }
      } else if (showDue && task.dueAt) {
        calendarItems.push(formatTask(task, new Date(task.dueAt), "due"));
      }

      if (showPlanned && task.plannedDate) {
        const pd = new Date(task.plannedDate);
        if (pd >= from && pd <= to) {
          const plannedAsDate = pd.toISOString().slice(0, 10);
          const dueAsDate = task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 10) : null;
          if (mode === "both" && dueAsDate === plannedAsDate) {
            const idx = calendarItems.findIndex(
              (i) => i.taskId === task.id && i.date.slice(0, 10) === plannedAsDate && i.type === "due"
            );
            if (idx >= 0) {
              calendarItems[idx].type = "due";
              calendarItems[idx].plannedDate = task.plannedDate?.toISOString() ?? null;
              continue;
            }
          }
          calendarItems.push(formatTask(task, pd, "planned"));
        }
      }
    }

    return calendarItems;
  });
}
