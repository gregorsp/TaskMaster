import { eq, and, like, or, inArray, ne, SQL, type Column, sql as drizzleSql, isNotNull, isNull } from "drizzle-orm";
import { v7 as uuid } from "uuid";
import { randomBytes } from "node:crypto";
import { getDb } from "../../db/client.js";
import {
  tasks, taskAssignees, taskCategories, taskEvents, taskLinks, taskOccurrences,
  users, categories, contexts, taskContexts,
} from "../../db/schema.js";
import { visibilityFilter, isVisibleToUserSync } from "../../middleware/visibility.js";
import { categoryIdsWithSameName } from "../categories/categories.service.js";
import { contextIdsWithSameName } from "../contexts/contexts.service.js";
import { parsePageQuery, paginate } from "../../lib/paging.js";
import { getEffectiveDueAt, isTaskOverdue, computeIsUrgent, getOccurrences } from "../calendar/recurrence.service.js";
import { getProfilePictureUrl } from "../auth/profile.service.js";
import {
  TASK_STATUSES, TASK_DURATIONS, TASK_ENERGIES,
  type CreateTaskInput, type UpdateTaskInput,
} from "./tasks.schema.js";

export function enrichTask(task: typeof tasks.$inferSelect) {
  return {
    ...task,
    isUrgent: computeIsUrgent(task),
    effectiveDueAt: getEffectiveDueAt(task)?.toISOString() || null,
    isOverdue: isTaskOverdue(task),
  };
}

/** 9 Zufallsbytes → 12 URL-sichere base64url-Zeichen (~72 Bit Entropie). */
export function generateTaskSlug(): string {
  return randomBytes(9).toString("base64url");
}

/** Eindeutigen Slug erzeugen (Kollisionsschleife gegen den Unique-Index). */
export function generateUniqueTaskSlug(): string {
  const db = getDb();
  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = generateTaskSlug();
    const taken = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.slug, slug)).get();
    if (!taken) return slug;
  }
  throw new Error("could not generate a unique task slug");
}

/** Task-ID über den öffentlichen Slug auflösen (ohne Sichtbarkeitsprüfung). */
export function findTaskIdBySlug(slug: string): string | null {
  const db = getDb();
  const row = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.slug, slug)).get();
  return row?.id ?? null;
}

/** Liefert den bestehenden Slug oder erzeugt einen, falls noch keiner existiert. */
export function ensureTaskSlug(id: string): { slug: string } | null {
  const db = getDb();
  const existing = db.select({ id: tasks.id, slug: tasks.slug }).from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return null;
  if (existing.slug) return { slug: existing.slug };
  const slug = generateUniqueTaskSlug();
  db.update(tasks).set({ slug }).where(eq(tasks.id, id)).run();
  return { slug };
}

interface TaskAssignee {
  id: string;
  username: string;
  displayName: string;
  profilePicture: string | null;
}

interface TaskCategory {
  id: string;
  name: string;
  color: string;
  createdById: string;
}

interface TaskContext {
  id: string;
  name: string;
  color: string;
  createdById: string;
}

function assigneesByTaskId(taskIds: string[]) {
  const db = getDb();
  if (taskIds.length === 0) return new Map<string, TaskAssignee[]>();
  const rows = db
    .select({
      taskId: taskAssignees.taskId,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      profilePicture: users.profilePicture,
    })
    .from(taskAssignees)
    .innerJoin(users, eq(taskAssignees.userId, users.id))
    .where(inArray(taskAssignees.taskId, taskIds))
    .all();
  const map = new Map<string, TaskAssignee[]>();
  for (const row of rows) {
    const list = map.get(row.taskId) || [];
    list.push({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      profilePicture: getProfilePictureUrl(row.profilePicture),
    });
    map.set(row.taskId, list);
  }
  return map;
}

function categoriesByTaskId(taskIds: string[]) {
  const db = getDb();
  const map = new Map<string, TaskCategory[]>();
  if (taskIds.length === 0) return map;
  const rows = db
    .select({
      taskId: taskCategories.taskId,
      id: categories.id,
      name: categories.name,
      color: categories.color,
      createdById: categories.createdById,
    })
    .from(taskCategories)
    .innerJoin(categories, eq(taskCategories.categoryId, categories.id))
    .where(inArray(taskCategories.taskId, taskIds))
    .all();
  for (const row of rows) {
    const list = map.get(row.taskId) || [];
    list.push({ id: row.id, name: row.name, color: row.color, createdById: row.createdById });
    map.set(row.taskId, list);
  }
  return map;
}

function contextsByTaskId(taskIds: string[]) {
  const db = getDb();
  const map = new Map<string, TaskContext[]>();
  if (taskIds.length === 0) return map;
  const rows = db
    .select({
      taskId: taskContexts.taskId,
      id: contexts.id,
      name: contexts.name,
      color: contexts.color,
      createdById: contexts.createdById,
    })
    .from(taskContexts)
    .innerJoin(contexts, eq(taskContexts.contextId, contexts.id))
    .where(inArray(taskContexts.taskId, taskIds))
    .all();
  for (const row of rows) {
    const list = map.get(row.taskId) || [];
    list.push({ id: row.id, name: row.name, color: row.color, createdById: row.createdById });
    map.set(row.taskId, list);
  }
  return map;
}

/** IDs aller Aufgaben, die mindestens eine Unteraufgabe haben (= Projekte). */
function projectTaskIds(): Set<string> {
  const db = getDb();
  const rows = db.select({ parentId: tasks.parentId }).from(tasks).where(isNotNull(tasks.parentId)).all();
  return new Set(rows.map((row) => row.parentId!).filter(Boolean));
}

type StepRow = { id: string; title: string; parentId: string | null; status: string | null; createdAt: Date };

/** Offene, nicht-Habit-Unteraufgaben der Projekte, älteste zuerst (Anlage-Reihenfolge = Schritt-Reihenfolge). */
function openSteps(projectIds: string[]): StepRow[] {
  if (projectIds.length === 0) return [];
  return getDb()
    .select({ id: tasks.id, title: tasks.title, parentId: tasks.parentId, status: tasks.status, createdAt: tasks.createdAt })
    .from(tasks)
    .where(and(inArray(tasks.parentId, projectIds), eq(tasks.isCompleted, false), eq(tasks.isHabit, false)))
    .all()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** Der aktuelle Nächste Schritt: erster mit Status `next`, sonst erster ohne Status. */
function pickNextStep(steps: StepRow[]): StepRow | undefined {
  return steps.find((s) => s.status === "next") ?? steps.find((s) => s.status === null);
}

/**
 * Hält ein Projekt am Laufen: Hat es keinen offenen Schritt mit Status `next`,
 * rückt der älteste offene Schritt ohne Status nach. `waiting`/`someday`
 * bleiben unangetastet. Liefert den nachgerückten Schritt.
 */
export function advanceNextStep(projectId: string | null): { id: string; title: string } | null {
  if (!projectId) return null;
  const steps = openSteps([projectId]);
  if (steps.some((s) => s.status === "next")) return null;
  const candidate = steps.find((s) => s.status === null);
  if (!candidate) return null;
  getDb().update(tasks).set({ status: "next" }).where(eq(tasks.id, candidate.id)).run();
  return { id: candidate.id, title: candidate.title };
}

function withRelations<T extends { id: string }>(items: T[]) {
  const ids = items.map((i) => i.id);
  const assignees = assigneesByTaskId(ids);
  const cats = categoriesByTaskId(ids);
  const ctxs = contextsByTaskId(ids);
  const projects = projectTaskIds();
  const projectIdsHere = ids.filter((id) => projects.has(id));
  const stepsByProject = new Map<string, StepRow[]>();
  for (const step of openSteps(projectIdsHere)) {
    const list = stepsByProject.get(step.parentId!) || [];
    list.push(step);
    stepsByProject.set(step.parentId!, list);
  }
  return items.map((item) => {
    const next = projects.has(item.id) ? pickNextStep(stepsByProject.get(item.id) || []) : undefined;
    return {
      ...item,
      assignees: assignees.get(item.id) || [],
      categories: cats.get(item.id) || [],
      contexts: ctxs.get(item.id) || [],
      isProject: projects.has(item.id),
      nextStep: next ? { id: next.id, title: next.title } : null,
    };
  });
}

/** Für den Nutzer sichtbare Aufgaben (Sichtbarkeit braucht den Join auf die Zuweisungen). */
function selectVisibleTasks(userId: string, ...extra: (SQL | undefined)[]) {
  return getDb().select().from(tasks)
    .leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId))
    .where(and(visibilityFilter(userId), ...extra))
    .groupBy(tasks.id)
    .all()
    .map((r) => r.tasks);
}

/**
 * Einmaliger Abgleich (beim Serverstart): jedes offene Projekt ohne Schritt mit
 * Status `next` bekommt seinen Nächsten Schritt – für Projekte aus der Zeit vor
 * der Automatik. Idempotent.
 */
export function reconcileNextSteps(): number {
  const open = getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.isCompleted, false)).all();
  const projectIds = projectTaskIds();
  let promoted = 0;
  for (const { id } of open) {
    if (projectIds.has(id) && advanceNextStep(id)) promoted++;
  }
  return promoted;
}

/** Exakter Filter auf eine GTD-Spalte; `none` = nicht gesetzt, unbekannte Werte werden ignoriert. */
function exactFilter(column: Column, value: unknown, allowed: readonly string[]): SQL | undefined {
  if (value === undefined || value === "") return undefined;
  const v = String(value);
  if (v === "none") return isNull(column);
  return allowed.includes(v) ? eq(column, v) : undefined;
}

const isTrue = (value: unknown) => value === true || value === "true";

export function listTasks(
  userId: string,
  _isAdmin: boolean,
  query: Record<string, unknown>
) {
  const db = getDb();
  const paging = parsePageQuery(query);

  const conditions: (SQL | undefined)[] = [];

  if (query.isCompleted !== undefined) conditions.push(eq(tasks.isCompleted, isTrue(query.isCompleted)));
  if (isTrue(query.important)) conditions.push(eq(tasks.isImportant, true));
  if (query.isHabit !== undefined) conditions.push(eq(tasks.isHabit, isTrue(query.isHabit)));
  if (isTrue(query.hidePlanned)) conditions.push(isNull(tasks.plannedDate));

  conditions.push(
    exactFilter(tasks.status, query.status, TASK_STATUSES),
    exactFilter(tasks.duration, query.duration, TASK_DURATIONS),
    exactFilter(tasks.energy, query.energy, TASK_ENERGIES),
  );

  if (query.search) {
    for (const token of String(query.search).trim().split(/\s+/).filter(Boolean)) {
      const term = `%${token}%`;
      conditions.push(or(like(tasks.title, term), like(tasks.description, term)) as SQL);
    }
  }

  if (query.isProject === "true" || query.isProject === true) {
    const projectIds = [...projectTaskIds()];
    if (projectIds.length === 0) return paginate([], 0, paging);
    conditions.push(inArray(tasks.id, projectIds));
  }

  // Eingangskorb: ungeklärte Einträge = oberste Ebene, kein Projekt, keine Kategorie, kein Status.
  // Unteraufgaben und Projekte gelten als bereits organisiert. Nur eigene bzw. mir zugewiesene
  // Einträge (der Ersteller ist immer zugewiesen) – öffentliche Aufgaben anderer gehören nicht hinein.
  if (isTrue(query.uncategorized)) {
    const withCategory = new Set(
      db.select({ taskId: taskCategories.taskId }).from(taskCategories).all().map((r) => r.taskId)
    );
    const mine = new Set(
      db.select({ taskId: taskAssignees.taskId }).from(taskAssignees).where(eq(taskAssignees.userId, userId)).all().map((r) => r.taskId)
    );
    const projects = projectTaskIds();
    const ids = db.select({ id: tasks.id, status: tasks.status, parentId: tasks.parentId }).from(tasks).all()
      .filter((row) => mine.has(row.id) && !withCategory.has(row.id) && !row.status && !row.parentId && !projects.has(row.id))
      .map((row) => row.id);
    if (ids.length === 0) return paginate([], 0, paging);
    conditions.push(inArray(tasks.id, ids));
  }

  if (query.categoryId) {
    const sameNameIds = categoryIdsWithSameName(String(query.categoryId));
    const rows = sameNameIds.length > 0
      ? db.select({ taskId: taskCategories.taskId }).from(taskCategories)
          .where(inArray(taskCategories.categoryId, sameNameIds)).all()
      : [];
    const ids = [...new Set(rows.map((r) => r.taskId))];
    if (ids.length > 0) conditions.push(inArray(tasks.id, ids));
    else return paginate([], 0, paging);
  }

  if (query.contextId) {
    const sameNameIds = contextIdsWithSameName(String(query.contextId));
    const rows = sameNameIds.length > 0
      ? db.select({ taskId: taskContexts.taskId }).from(taskContexts)
          .where(inArray(taskContexts.contextId, sameNameIds)).all()
      : [];
    const ids = [...new Set(rows.map((r) => r.taskId))];
    if (ids.length > 0) conditions.push(inArray(tasks.id, ids));
    else return paginate([], 0, paging);
  }

  if (query.assigneeId) {
    const sub = db.select({ taskId: taskAssignees.taskId }).from(taskAssignees).where(eq(taskAssignees.userId, query.assigneeId as string));
    const ids = sub.all().map((r) => r.taskId);
    if (ids.length > 0) conditions.push(inArray(tasks.id, ids));
    else return paginate([], 0, paging);
  }

  if (query.assigneeIds) {
    const ids = String(query.assigneeIds).split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      const rows = db
        .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(inArray(taskAssignees.userId, ids))
        .all();
      const perUser = new Map<string, Set<string>>();
      for (const r of rows) {
        if (!perUser.has(r.userId)) perUser.set(r.userId, new Set());
        perUser.get(r.userId)!.add(r.taskId);
      }
      let matching = new Set(perUser.get(ids[0]) || []);
      for (let i = 1; i < ids.length && matching.size > 0; i++) {
        const set = perUser.get(ids[i]);
        if (!set) {
          matching = new Set();
          break;
        }
        matching = new Set([...matching].filter((x) => set.has(x)));
      }
      if (matching.size > 0) conditions.push(inArray(tasks.id, [...matching]));
      else return paginate([], 0, paging);
    }
  }

  let enriched = selectVisibleTasks(userId, ...conditions).map(enrichTask);

  // Überfällig und dringend werden erst beim Anreichern berechnet
  // (die Spalte `is_urgent` ist nicht maßgeblich).
  if (isTrue(query.isOverdue)) enriched = enriched.filter((t) => t.isOverdue);
  if (isTrue(query.urgent)) enriched = enriched.filter((t) => t.isUrgent);

  let sorted = enriched;
  const sort = (query.sort as string) || "createdAt";
  const order = (query.order as "asc" | "desc") || "desc";
  if (sort === "dueAt") {
    sorted = enriched.sort((a, b) => {
      const da = a.effectiveDueAt ? new Date(a.effectiveDueAt).getTime() : 0;
      const db = b.effectiveDueAt ? new Date(b.effectiveDueAt).getTime() : 0;
      return order === "asc" ? da - db : db - da;
    });
  } else {
    sorted = enriched.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return order === "asc" ? da - db : db - da;
    });
  }

  const total = sorted.length;
  const start = (paging.page - 1) * paging.pageSize;
  const items = sorted.slice(start, start + paging.pageSize);

  return paginate(withRelations(items), total, paging);
}

/**
 * Auswertung für den GTD Weekly Review (nur sichtbare, offene Aufgaben):
 * - `inboxCount`: ungeklärte Einträge im Eingangskorb (gleiche Definition wie die Liste).
 * - `stalledProjects`: Projekte ohne offenen Nächsten Schritt. Als Nächster Schritt
 *   zählt jede offene Unteraufgabe mit Status `next` oder ohne Status.
 * - `waiting`: alle „Warten auf“-Einträge, älteste zuerst (zum Nachfassen).
 * - `somedayCount`: Umfang der Irgendwann/Vielleicht-Liste.
 */
export function getWeeklyReview(userId: string) {
  const inboxCount = listTasks(userId, false, { isCompleted: false, uncategorized: true, pageSize: 1 }).total;

  const open = selectVisibleTasks(userId, eq(tasks.isCompleted, false));
  const projectIds = projectTaskIds();
  const byCreated = (a: { createdAt: Date }, b: { createdAt: Date }) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  const projects = open.filter((t) => projectIds.has(t.id)).sort(byCreated);
  const waiting = open.filter((t) => t.status === "waiting").sort(byCreated);

  return {
    inboxCount,
    somedayCount: open.filter((t) => t.status === "someday").length,
    stalledProjects: withRelations(projects.map(enrichTask)).filter((p) => !p.nextStep),
    waiting: withRelations(waiting.map(enrichTask)),
  };
}

export async function getTask(id: string, userId: string, _isAdmin: boolean) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return null;

  const [withRel] = withRelations([task]);
  return enrichTask(withRel as unknown as typeof task);
}

export interface DueDateConflict {
  taskId: string;
  title: string;
  dueAt: string | null;
  requiredDueAt: string | null;
}

export interface DueDateBlocked {
  blocked: true;
  code: "SUBTASK_DUE_CONFLICT";
  conflicts: DueDateConflict[];
}

function taskDueDate(task: { dueAt: Date | null; baseDate: Date | null }): Date | null {
  return task.dueAt ?? task.baseDate;
}

function dayKey(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function collectAncestorIds(taskId: string, result: Set<string>) {
  const db = getDb();
  const row = db.select({ id: tasks.id, parentId: tasks.parentId }).from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row) return;
  if (!result.has(row.id)) {
    result.add(row.id);
    if (row.parentId && !result.has(row.parentId)) collectAncestorIds(row.parentId, result);
  }
}

function checkDueDateConflicts(opts: {
  parentId?: string | null;
  dueDate?: Date | null;
  taskId?: string;
}): DueDateConflict[] {
  const db = getDb();
  if (!opts.dueDate) return [];
  const due = dayKey(opts.dueDate);
  const conflicts: DueDateConflict[] = [];

  if (opts.parentId) {
    const ancestorIds = new Set<string>();
    collectAncestorIds(opts.parentId, ancestorIds);
    if (ancestorIds.size > 0) {
      const rows = db.select().from(tasks).where(inArray(tasks.id, [...ancestorIds])).all();
      for (const a of rows) {
        const aDue = taskDueDate(a);
        if (aDue && dayKey(aDue) < due) {
          conflicts.push({ taskId: a.id, title: a.title, dueAt: aDue.toISOString(), requiredDueAt: opts.dueDate.toISOString() });
        }
      }
    }
  }

  if (opts.taskId) {
    const descendantIds = new Set<string>();
    collectDescendantIds(opts.taskId, descendantIds);
    if (descendantIds.size > 0) {
      const rows = db.select().from(tasks).where(inArray(tasks.id, [...descendantIds])).all();
      for (const d of rows) {
        const dDue = taskDueDate(d);
        if (dDue && dayKey(dDue) > due) {
          conflicts.push({ taskId: d.id, title: d.title, dueAt: dDue.toISOString(), requiredDueAt: opts.dueDate.toISOString() });
        }
      }
    }
  }

  return conflicts;
}

function applyDueDateResolution(opts: {
  parentId?: string | null;
  dueDate?: Date | null;
  taskId?: string;
}): number {
  const db = getDb();
  if (!opts.dueDate) return 0;
  const due = dayKey(opts.dueDate);
  let changed = 0;

  const setTaskDue = (row: { id: string; recurrenceType: string; dueAt: Date | null; baseDate: Date | null }, date: Date) => {
    if (row.recurrenceType === "rrule") {
      if (dayKey(row.baseDate) !== due) {
        db.update(tasks).set({ baseDate: date }).where(eq(tasks.id, row.id)).run();
        changed++;
      }
    } else {
      if (dayKey(row.dueAt) !== due) {
        db.update(tasks).set({ dueAt: date }).where(eq(tasks.id, row.id)).run();
        changed++;
      }
    }
  };

  if (opts.parentId) {
    const ancestorIds = new Set<string>();
    collectAncestorIds(opts.parentId, ancestorIds);
    if (ancestorIds.size > 0) {
      const rows = db.select().from(tasks).where(inArray(tasks.id, [...ancestorIds])).all();
      for (const a of rows) {
        const aDue = taskDueDate(a);
        if (aDue && dayKey(aDue) < due) setTaskDue(a, opts.dueDate);
      }
    }
  }

  if (opts.taskId) {
    const descendantIds = new Set<string>();
    collectDescendantIds(opts.taskId, descendantIds);
    if (descendantIds.size > 0) {
      const rows = db.select().from(tasks).where(inArray(tasks.id, [...descendantIds])).all();
      for (const d of rows) {
        const dDue = taskDueDate(d);
        if (dDue && dayKey(dDue) > due) setTaskDue(d, opts.dueDate);
      }
    }
  }

  return changed;
}

function requireVisibleTask(taskId: string, userId: string, code = "PARENT_NOT_FOUND"): typeof tasks.$inferSelect {
  const db = getDb();
  const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row || !isVisibleToUserSync(taskId, userId)) {
    throw Object.assign(new Error("Parent task not found"), { statusCode: 404, code });
  }
  return row;
}

export function createTask(input: CreateTaskInput, createdById: string): (typeof tasks.$inferInsert) | DueDateBlocked {
  const db = getDb();
  const isHabit = input.isHabit ?? false;
  const creator = db.select({ defaultPrivate: users.defaultPrivate }).from(users).where(eq(users.id, createdById)).get();
  const defaultPrivate = creator?.defaultPrivate ?? true;

  let parent: typeof tasks.$inferSelect | undefined;
  if (!isHabit && input.parentId) {
    parent = requireVisibleTask(input.parentId, createdById);
    if (parent.isHabit) {
      throw Object.assign(new Error("Habits cannot have subtasks"), { statusCode: 400, code: "PARENT_IS_HABIT" });
    }
  }

  const dueAtVal = isHabit ? null
    : input.recurrenceType === "rrule" ? null
    : input.dueAt ? new Date(input.dueAt) : null;
  const baseDateVal = !isHabit && input.recurrenceType === "rrule" && input.dueAt
    ? new Date(input.dueAt) : null;

  const dueDateVal = dueAtVal ?? baseDateVal;
  if (!isHabit && input.parentId && dueDateVal && !input.forceDueDate) {
    const conflicts = checkDueDateConflicts({ parentId: input.parentId, dueDate: dueDateVal });
    if (conflicts.length > 0) {
      if (input.resolveDueDateConflicts) {
        applyDueDateResolution({ parentId: input.parentId, dueDate: dueDateVal });
      } else {
        return { blocked: true, code: "SUBTASK_DUE_CONFLICT", conflicts };
      }
    }
  }

  // Privatheit: Habits immer privat, Unteraufgaben erben von der Elternaufgabe,
  // sonst gilt die Nutzer-Voreinstellung (Standard: privat).
  const isPrivate = isHabit ? true : parent ? parent.isPrivate : (input.isPrivate ?? defaultPrivate);

  const task = {
    id: uuid(),
    slug: generateUniqueTaskSlug(),
    title: input.title,
    description: input.description || null,
    dueAt: dueAtVal,
    baseDate: baseDateVal,
    lastCompletedAt: null,
    isCompleted: false,
    completedAt: null,
    completedById: null,
    isImportant: input.isImportant ?? false,
    pomodoros: input.pomodoros ?? null,
    pomodoroMinutes: input.pomodoroMinutes ?? null,
    isUrgent: false, // computed field
    urgencyMode: isHabit ? "never" : (input.urgencyMode ?? "before_days"),
    urgencyValue: isHabit ? null : (input.urgencyValue ?? 3),
    isPrivate,
    isHabit,
    // Ein neuer Schritt ohne Status wird zum Nächsten Schritt, wenn das Projekt noch keinen hat.
    status: isHabit
      ? null
      : (input.status ?? (input.parentId && !openSteps([input.parentId]).some((s) => s.status === "next") ? "next" : null)),
    duration: isHabit ? null : (input.duration ?? null),
    energy: isHabit ? null : (input.energy ?? null),
    recurrenceType: isHabit ? "none" : (input.recurrenceType ?? "none"),
    recurrenceRule: isHabit ? null : (input.recurrenceRule || null),
    parentId: isHabit ? null : (input.parentId || null),
    plannedDate: isHabit ? null : (input.plannedDate ? new Date(input.plannedDate) : null),
    createdById,
    createdAt: new Date(),
  };

  db.insert(tasks).values(task).run();

  const seen = new Set<string>();
  seen.add(createdById);
  db.insert(taskAssignees).values({ taskId: task.id, userId: createdById }).run();

  if (!isHabit) {
    for (const assigneeId of (input.assigneeIds || [])) {
      if (!seen.has(assigneeId)) {
        seen.add(assigneeId);
        db.insert(taskAssignees).values({ taskId: task.id, userId: assigneeId }).run();
      }
    }
  }
  for (const catId of (input.categoryIds || [])) {
    if (db.select({ id: categories.id }).from(categories).where(eq(categories.id, catId)).get()) {
      db.insert(taskCategories).values({ taskId: task.id, categoryId: catId }).run();
    }
  }
  for (const ctxId of (input.contextIds || [])) {
    if (db.select({ id: contexts.id }).from(contexts).where(eq(contexts.id, ctxId)).get()) {
      db.insert(taskContexts).values({ taskId: task.id, contextId: ctxId }).run();
    }
  }

  return task;
}

export async function updateTask(id: string, input: UpdateTaskInput, userId: string, isAdmin: boolean) {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return null;

  const isOwner = existing.createdById === userId;
  if (!isOwner) {
    if (input.isPrivate !== undefined) {
      throw Object.assign(new Error("Only the creator may change privacy"), { statusCode: 403, code: "FORBIDDEN" });
    }
    if (input.assigneeIds !== undefined) {
      throw Object.assign(new Error("Only the creator may change assignees"), { statusCode: 403, code: "FORBIDDEN" });
    }
    if (input.isHabit !== undefined && input.isHabit !== existing.isHabit) {
      throw Object.assign(new Error("Only the creator may convert habits"), { statusCode: 403, code: "FORBIDDEN" });
    }
  }

  const isHabit = input.isHabit ?? existing.isHabit;

  const updates: Record<string, unknown> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.isImportant !== undefined) updates.isImportant = input.isImportant;
  if (input.pomodoros !== undefined) updates.pomodoros = input.pomodoros;
  if (input.pomodoroMinutes !== undefined) updates.pomodoroMinutes = input.pomodoroMinutes;
  if (input.isPrivate !== undefined && !isHabit) updates.isPrivate = input.isPrivate;
  if (input.urgencyMode !== undefined) updates.urgencyMode = input.urgencyMode;
  if (input.urgencyValue !== undefined) updates.urgencyValue = input.urgencyValue;
  if (input.isHabit !== undefined && input.isHabit !== existing.isHabit) updates.isHabit = input.isHabit;
  if (!isHabit) {
    if (input.status !== undefined) updates.status = input.status;
    if (input.duration !== undefined) updates.duration = input.duration;
    if (input.energy !== undefined) updates.energy = input.energy;
  }

  const becomingHabit = input.isHabit === true && existing.isHabit !== true;
  if (becomingHabit) {
    updates.isPrivate = true;
    updates.status = null;
    updates.duration = null;
    updates.energy = null;
    updates.plannedDate = null;
    updates.dueAt = null;
    updates.baseDate = null;
    updates.recurrenceType = "none";
    updates.recurrenceRule = null;
    updates.parentId = null;
    updates.urgencyMode = "never";
    updates.urgencyValue = null;
  }

  const recurrenceChanging = (input.recurrenceType !== undefined && input.recurrenceType !== existing.recurrenceType)
    || (input.recurrenceRule !== undefined && input.recurrenceRule !== existing.recurrenceRule);

  if (recurrenceChanging && !input.forceUpdateRecurrence && !becomingHabit) {
    const plannedRows = db.select({ id: taskOccurrences.id })
      .from(taskOccurrences)
      .where(and(eq(taskOccurrences.taskId, id), isNotNull(taskOccurrences.plannedDate)))
      .all();
    if (plannedRows.length > 0) {
      return { blocked: true, code: "WILL_DELETE_PLANNED_OCCURRENCES", count: plannedRows.length };
    }
  }

  if (input.recurrenceType !== undefined && !isHabit) updates.recurrenceType = input.recurrenceType;
  if (input.recurrenceRule !== undefined && !isHabit) updates.recurrenceRule = input.recurrenceRule;

  if (input.parentId !== undefined && !isHabit) {
    if (input.parentId === null) {
      updates.parentId = null;
    } else {
      if (input.parentId === id) {
        throw Object.assign(new Error("A task cannot be its own parent"), { statusCode: 400, code: "INVALID_PARENT" });
      }
      const parent = requireVisibleTask(input.parentId, userId);
      if (parent.isHabit) {
        throw Object.assign(new Error("Habits cannot have subtasks"), { statusCode: 400, code: "PARENT_IS_HABIT" });
      }
      const descendants = new Set<string>();
      collectDescendantIds(id, descendants);
      if (descendants.has(input.parentId)) {
        throw Object.assign(new Error("A task cannot move below its own descendant"), { statusCode: 400, code: "INVALID_PARENT" });
      }
      updates.parentId = input.parentId;
      // Unteraufgaben erben die Privatheit der neuen Elternaufgabe.
      if (!isHabit) updates.isPrivate = parent.isPrivate;
    }
  }

  if (input.plannedDate !== undefined && !isHabit) updates.plannedDate = input.plannedDate ? new Date(input.plannedDate) : null;

  if (input.dueAt !== undefined && !isHabit) {
    if (input.recurrenceType === "rrule" || existing.recurrenceType === "rrule") {
      updates.baseDate = input.dueAt ? new Date(input.dueAt) : null;
      updates.dueAt = null;
    } else {
      updates.dueAt = input.dueAt ? new Date(input.dueAt) : null;
    }
  }

  if (!isHabit) {
    const finalParentId = input.parentId !== undefined ? input.parentId : existing.parentId;
    const finalRecurrenceType = input.recurrenceType ?? existing.recurrenceType;
    let dueDate: Date | null;
    if (input.dueAt !== undefined) {
      dueDate = input.dueAt ? new Date(input.dueAt) : null;
    } else if (finalRecurrenceType === "rrule") {
      dueDate = existing.baseDate;
    } else {
      dueDate = existing.dueAt;
    }
    if (!input.forceDueDate) {
      const conflicts = checkDueDateConflicts({ parentId: finalParentId, dueDate, taskId: id });
      if (conflicts.length > 0) {
        if (input.resolveDueDateConflicts) {
          applyDueDateResolution({ parentId: finalParentId, dueDate, taskId: id });
        } else {
          return { blocked: true, code: "SUBTASK_DUE_CONFLICT", conflicts };
        }
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    db.update(tasks).set(updates).where(eq(tasks.id, id)).run();
  }

  // Privatheit ist an der Wurzel definiert: Ändert sie sich, ziehen alle
  // Unteraufgaben mit (auch nach einem Elternwechsel).
  const privacyChanged = updates.isPrivate !== undefined && updates.isPrivate !== existing.isPrivate;
  if (privacyChanged) {
    const descendants = new Set<string>();
    collectDescendantIds(id, descendants);
    for (const descendantId of descendants) {
      db.update(tasks).set({ isPrivate: updates.isPrivate as boolean }).where(eq(tasks.id, descendantId)).run();
    }
  }

  if (recurrenceChanging && input.forceUpdateRecurrence) {
    db.delete(taskOccurrences)
      .where(and(eq(taskOccurrences.taskId, id), isNotNull(taskOccurrences.plannedDate)))
      .run();
  }

  if (becomingHabit) {
    db.delete(taskOccurrences)
      .where(eq(taskOccurrences.taskId, id))
      .run();
  }

  if (input.assigneeIds !== undefined && !isHabit) {
    db.delete(taskAssignees).where(eq(taskAssignees.taskId, id)).run();
    const seen = new Set<string>();
    for (const aid of input.assigneeIds) {
      if (seen.has(aid)) continue;
      seen.add(aid);
      db.insert(taskAssignees).values({ taskId: id, userId: aid }).run();
    }
  }
  if (isHabit) {
    db.delete(taskAssignees).where(eq(taskAssignees.taskId, id)).run();
    db.insert(taskAssignees).values({ taskId: id, userId: existing.createdById }).run();
  }
  if (input.categoryIds !== undefined) {
    db.delete(taskCategories).where(eq(taskCategories.taskId, id)).run();
    for (const cid of input.categoryIds) {
      if (db.select({ id: categories.id }).from(categories).where(eq(categories.id, cid)).get()) {
        db.insert(taskCategories).values({ taskId: id, categoryId: cid }).run();
      }
    }
  }
  if (input.contextIds !== undefined && !isHabit) {
    db.delete(taskContexts).where(eq(taskContexts.taskId, id)).run();
    for (const cid of input.contextIds) {
      if (db.select({ id: contexts.id }).from(contexts).where(eq(contexts.id, cid)).get()) {
        db.insert(taskContexts).values({ taskId: id, contextId: cid }).run();
      }
    }
  }

  // Nächsten Schritt nachziehen, wenn dieser Schritt kein `next` mehr ist oder das Projekt wechselt.
  const after = db.select({ parentId: tasks.parentId, status: tasks.status }).from(tasks).where(eq(tasks.id, id)).get();
  if (after && existing.parentId && (after.parentId !== existing.parentId || (existing.status === "next" && after.status !== "next"))) {
    advanceNextStep(existing.parentId);
  }
  if (after?.parentId && after.parentId !== existing.parentId) advanceNextStep(after.parentId);

  return getTask(id, userId, isAdmin);
}

export async function deleteTask(id: string, userId: string): Promise<boolean | { blocked: boolean; code: string }> {
  const db = getDb();
  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return false;
  if (existing.createdById !== userId) {
    throw Object.assign(new Error("Only the creator may delete a task"), { statusCode: 403, code: "FORBIDDEN" });
  }

  const childCount = db.select({ count: drizzleSql<number>`COUNT(*)` }).from(tasks).where(eq(tasks.parentId, id)).get();
  if (childCount && childCount.count > 0) {
    return { blocked: true, code: "HAS_SUBTASKS" };
  }

  db.delete(taskAssignees).where(eq(taskAssignees.taskId, id)).run();
  db.delete(taskCategories).where(eq(taskCategories.taskId, id)).run();
  db.delete(taskContexts).where(eq(taskContexts.taskId, id)).run();
  db.delete(taskEvents).where(eq(taskEvents.taskId, id)).run();
  db.delete(taskLinks).where(or(eq(taskLinks.taskIdA, id), eq(taskLinks.taskIdB, id))).run();
  db.delete(tasks).where(eq(tasks.id, id)).run();
  advanceNextStep(existing.parentId);
  return true;
}

export function getSubtasks(taskId: string, userId: string) {
  const db = getDb();
  const children = db.select().from(tasks).where(eq(tasks.parentId, taskId)).all()
    .filter((child) => isVisibleToUserSync(child.id, userId));

  const completed = children.filter((c) => c.isCompleted).length;
  const total = children.length;

  const allDescendantIds = new Set<string>();
  for (const child of children) {
    allDescendantIds.add(child.id);
    collectDescendantIds(child.id, allDescendantIds);
  }
  const visibleDescendants = [...allDescendantIds].filter((descendantId) => isVisibleToUserSync(descendantId, userId));

  let completedDescendants = 0;
  for (const descendantId of visibleDescendants) {
    const t = db.select().from(tasks).where(eq(tasks.id, descendantId)).get();
    if (t?.isCompleted) completedDescendants++;
  }

  return {
    subtasks: withRelations(children.map(enrichTask)),
    progress: {
      completed: completedDescendants,
      total: visibleDescendants.length,
      completedDirect: completed,
      totalDirect: total,
    },
  };
}

export function collectDescendantIds(taskId: string, result: Set<string>) {
  const db = getDb();
  const children = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, taskId)).all();
  for (const child of children) {
    if (!result.has(child.id)) {
      result.add(child.id);
      collectDescendantIds(child.id, result);
    }
  }
}

export function getOpenSubtaskCount(taskId: string): number {
  const db = getDb();
  const descendantIds = new Set<string>();
  collectDescendantIds(taskId, descendantIds);
  if (descendantIds.size === 0) return 0;

  const rows = db.select({ id: tasks.id, isCompleted: tasks.isCompleted })
    .from(tasks)
    .where(inArray(tasks.id, [...descendantIds]))
    .all();

  return rows.filter((r) => !r.isCompleted).length;
}

export function getSiblings(taskId: string, userId: string) {
  const db = getDb();
  const task = db.select({ parentId: tasks.parentId }).from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task?.parentId) return [];

  const siblings = db.select().from(tasks)
    .where(eq(tasks.parentId, task.parentId))
    .all()
    .filter((s) => s.id !== taskId && isVisibleToUserSync(s.id, userId));
  return withRelations(siblings.map(enrichTask));
}

export function getTaskLinks(taskId: string, userId: string) {
  const db = getDb();
  const rows = db.select({
    taskId: drizzleSql<string>`CASE WHEN task_links.task_id_a = ${taskId} THEN task_links.task_id_b ELSE task_links.task_id_a END`,
  }).from(taskLinks)
    .where(or(eq(taskLinks.taskIdA, taskId), eq(taskLinks.taskIdB, taskId)))
    .all();

  if (rows.length === 0) return [];

  const linkedIds = rows.map((r) => r.taskId);
  const linkedTasks = db.select().from(tasks).where(inArray(tasks.id, linkedIds)).all()
    .filter((task) => isVisibleToUserSync(task.id, userId));
  return withRelations(linkedTasks.map(enrichTask));
}

export function addTaskLink(taskId: string, linkedTaskId: string) {
  const db = getDb();
  const now = new Date();
  const existing = db.select({ taskIdA: taskLinks.taskIdA }).from(taskLinks)
    .where(and(eq(taskLinks.taskIdA, taskId), eq(taskLinks.taskIdB, linkedTaskId)))
    .get();
  if (existing) return { ok: true };
  db.insert(taskLinks).values({ taskIdA: taskId, taskIdB: linkedTaskId, createdAt: now }).run();
  db.insert(taskLinks).values({ taskIdA: linkedTaskId, taskIdB: taskId, createdAt: now }).run();
  return { ok: true };
}

export function removeTaskLink(taskId: string, linkedTaskId: string) {
  const db = getDb();
  db.delete(taskLinks).where(
    and(eq(taskLinks.taskIdA, taskId), eq(taskLinks.taskIdB, linkedTaskId))
  ).run();
  db.delete(taskLinks).where(
    and(eq(taskLinks.taskIdA, linkedTaskId), eq(taskLinks.taskIdB, taskId))
  ).run();
  return { ok: true };
}

export function getTaskOccurrences(taskId: string) {
  const db = getDb();
  return db.select().from(taskOccurrences).where(eq(taskOccurrences.taskId, taskId)).all();
}

export function createTaskOccurrence(taskId: string, occurrenceDate: string, plannedDate: string | null) {
  const db = getDb();
  const occDate = new Date(occurrenceDate);
  const existing = db.select().from(taskOccurrences)
    .where(and(eq(taskOccurrences.taskId, taskId), eq(taskOccurrences.occurrenceDate, occDate)))
    .get();

  if (existing) {
    db.update(taskOccurrences).set({ plannedDate: plannedDate ? new Date(plannedDate) : null })
      .where(eq(taskOccurrences.id, existing.id)).run();
    return existing;
  }

  const row = {
    id: uuid(),
    taskId,
    occurrenceDate: occDate,
    plannedDate: plannedDate ? new Date(plannedDate) : null,
    isCompleted: false,
    completedAt: null,
    completedById: null,
    note: null,
    createdAt: new Date(),
  };
  db.insert(taskOccurrences).values(row).run();
  return row;
}

export function deleteTaskOccurrence(taskId: string, occurrenceId: string) {
  const db = getDb();
  db.delete(taskOccurrences)
    .where(and(eq(taskOccurrences.id, occurrenceId), eq(taskOccurrences.taskId, taskId)))
    .run();
  return { ok: true };
}

export function getUpcomingOccurrences(taskId: string, count = 3, showPast = false) {
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task || task.recurrenceType !== "rrule" || !task.recurrenceRule || !task.baseDate) {
    return [];
  }

  const rows = db.select().from(taskOccurrences).where(eq(taskOccurrences.taskId, taskId)).all();

  const completedDates = new Set<string>();
  const plannedMap = new Map<string, string>();

  for (const r of rows) {
    const iso = r.occurrenceDate instanceof Date
      ? new Date(r.occurrenceDate.getFullYear(), r.occurrenceDate.getMonth(), r.occurrenceDate.getDate()).toISOString()
      : "";
    if (r.isCompleted) completedDates.add(iso);
    if (r.plannedDate) plannedMap.set(iso, r.plannedDate instanceof Date ? r.plannedDate.toISOString() : String(r.plannedDate));
  }

  const now = new Date();
  const to = new Date();
  to.setFullYear(to.getFullYear() + 2);

  let dates: Date[];
  if (showPast && task.baseDate) {
    const past = getOccurrences(task.recurrenceRule, task.baseDate, now, task.baseDate);
    const future = getOccurrences(task.recurrenceRule, now, to, task.baseDate).slice(0, count);
    const seen = new Set<string>();
    dates = [];
    for (const d of [...past, ...future]) {
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      if (!seen.has(key)) {
        seen.add(key);
        dates.push(d);
      }
    }
  } else {
    dates = getOccurrences(task.recurrenceRule, now, to, task.baseDate).slice(0, count);
  }

  return dates.map((d) => {
    const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    return {
      date: d,
      iso,
      isCompleted: completedDates.has(iso),
      completedAt: null,
      isPlanned: plannedMap.has(iso),
      plannedDate: plannedMap.get(iso) || null,
    };
  });
}
