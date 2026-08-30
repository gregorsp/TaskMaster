import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import { initDb, closeDb, getDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import { v7 as uuid } from "uuid";
import { scrypt, randomBytes } from "node:crypto";
import { users } from "../src/db/schema.js";
import type { FastifyInstance } from "fastify";

const KEYLEN = 64;

function hashPassword(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, (err, k) => err ? reject(err) : resolve(salt + ":" + k.toString("hex")));
  });
}

let app: FastifyInstance;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  await initDb();
  const db = getDb();
  migrate(db, { migrationsFolder: "./src/db/migrations" });

  const salt = randomBytes(16).toString("hex");
  const pw = await hashPassword("admin123admin", salt);

  db.insert(users).values({
    id: uuid(), username: "admin2", email: "admin2@test.com",
    passwordHash: pw, displayName: "Admin 2", isAdmin: true, createdAt: new Date(),
  }).run();

  app = await buildApp();
  await app.ready();

  const login = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "admin2@test.com", password: "admin123admin" },
  });
  adminToken = login.json().accessToken;

  await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { username: "user1", email: "user1@test.com", password: "user123456", displayName: "User 1" },
  });
  const userLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    payload: { email: "user1@test.com", password: "user123456" },
  });
  userToken = userLogin.json().accessToken;
});

afterAll(async () => {
  await app.close();
  closeDb();
});

function headers(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("Tasks CRUD", () => {
  let taskId: string;

  it("creates a task", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(adminToken),
      payload: {
        title: "Test Task",
        description: "A test task",
        isImportant: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe("Test Task");
    expect(body.isImportant).toBe(true);
    taskId = body.id;
  });

  it("lists tasks", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/tasks",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("gets a single task", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/tasks/${taskId}`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Test Task");
  });

  it("updates a task", async () => {
    const res = await app.inject({
      method: "PUT", url: `/api/tasks/${taskId}`,
      headers: headers(adminToken),
      payload: { title: "Updated Task", urgencyMode: "always" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Updated Task");
    expect(res.json().isUrgent).toBe(true);
  });

  it("completes a non-recurring task", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${taskId}/complete`,
      headers: headers(adminToken),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().completed).toBe(true);
  });

  it("reopens a task", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/tasks/${taskId}/reopen`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("deletes a task", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/api/tasks/${taskId}`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});

describe("Private tasks visibility", () => {
  let privateTaskId: string;

  it("admin creates private task", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(adminToken),
      payload: { title: "Secret Task", isPrivate: true },
    });
    expect(res.statusCode).toBe(201);
    privateTaskId = res.json().id;
  });

  it("creator can see private task", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/tasks/${privateTaskId}`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it("other user cannot see private task", async () => {
    const res = await app.inject({
      method: "GET", url: `/api/tasks/${privateTaskId}`,
      headers: headers(userToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("other user does not see private task in list", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/tasks",
      headers: headers(userToken),
    });
    const body = res.json();
    const found = body.items.find((t: { id: string }) => t.id === privateTaskId);
    expect(found).toBeUndefined();
  });
});

describe("Categories", () => {
  let catId: string;

  it("creates a category with auto color", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/categories",
      headers: headers(adminToken),
      payload: { name: "Work" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Work");
    expect(body.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    catId = body.id;
  });

  it("lists categories", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/categories",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("deletes category", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/api/categories/${catId}`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("Users admin", () => {
  it("lists users (admin only)", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/users",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("non-admin cannot list users", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/users",
      headers: headers(userToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Calendar", () => {
  it("returns empty array for empty range", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/calendar?from=2020-01-01&to=2020-01-31",
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("Task filters", () => {
  let adminId: string;
  let user1Id: string;

  beforeAll(async () => {
    const picker = await app.inject({ method: "GET", url: "/api/users/picker", headers: headers(adminToken) });
    const users = picker.json() as { id: string; username: string }[];
    adminId = users.find((u) => u.username === "admin2")!.id;
    user1Id = users.find((u) => u.username === "user1")!.id;
  });

  const createTask = async (payload: Record<string, unknown>) => {
    const res = await app.inject({ method: "POST", url: "/api/tasks", headers: headers(adminToken), payload });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  };

  const deleteTask = async (id: string) => {
    await app.inject({ method: "DELETE", url: `/api/tasks/${id}`, headers: headers(adminToken) });
  };

  const listIds = async (qs: string) => {
    const res = await app.inject({ method: "GET", url: `/api/tasks?${qs}`, headers: headers(adminToken) });
    expect(res.statusCode).toBe(200);
    return (res.json().items as { id: string }[]).map((t) => t.id);
  };

  it("filters overdue tasks", async () => {
    const pastId = await createTask({ title: "Overdue Task", dueAt: new Date(Date.now() - 86400000).toISOString() });
    const futureId = await createTask({ title: "Future Task", dueAt: new Date(Date.now() + 86400000).toISOString() });

    const ids = await listIds("isOverdue=true");
    expect(ids).toContain(pastId);
    expect(ids).not.toContain(futureId);

    await deleteTask(pastId);
    await deleteTask(futureId);
  });

  it("filters by multiple assignees with AND semantics", async () => {
    const both = await createTask({ title: "Both Assignees", assigneeIds: [adminId, user1Id] });
    const onlyUser = await createTask({ title: "Only User", assigneeIds: [user1Id] });
    const adminOnly = await createTask({ title: "Admin Only" });

    const bothIds = await listIds(`assigneeIds=${encodeURIComponent(`${adminId},${user1Id}`)}`);
    expect(bothIds).toContain(both);
    expect(bothIds).toContain(onlyUser);
    expect(bothIds).not.toContain(adminOnly);

    const userOnlyIds = await listIds(`assigneeId=${user1Id}`);
    expect(userOnlyIds).toContain(both);
    expect(userOnlyIds).toContain(onlyUser);
    expect(userOnlyIds).not.toContain(adminOnly);

    await deleteTask(both);
    await deleteTask(onlyUser);
    await deleteTask(adminOnly);
  });

  it("lists all tasks of a category (multiple matches)", async () => {
    const catRes = await app.inject({
      method: "POST", url: "/api/categories", headers: headers(adminToken), payload: { name: "Filter Work" },
    });
    const catId = catRes.json().id;

    const t1 = await createTask({ title: "Category Task 1", categoryIds: [catId] });
    const t2 = await createTask({ title: "Category Task 2", categoryIds: [catId] });

    const ids = await listIds(`categoryId=${catId}`);
    expect(ids).toContain(t1);
    expect(ids).toContain(t2);

    await deleteTask(t1);
    await deleteTask(t2);
    await app.inject({ method: "DELETE", url: `/api/categories/${catId}`, headers: headers(adminToken) });
  });

  it("hides already-planned tasks with hidePlanned", async () => {
    const plannedId = await createTask({ title: "Planned Task", plannedDate: new Date(Date.now() + 86400000).toISOString() });
    const unplannedId = await createTask({ title: "Unplanned Task" });

    const ids = await listIds("hidePlanned=true");
    expect(ids).toContain(unplannedId);
    expect(ids).not.toContain(plannedId);

    await deleteTask(plannedId);
    await deleteTask(unplannedId);
  });
});

describe("Pomodoros", () => {
  const createTask = async (payload: Record<string, unknown>) => {
    const res = await app.inject({ method: "POST", url: "/api/tasks", headers: headers(adminToken), payload });
    return res;
  };
  const deleteTask = async (id: string) => {
    await app.inject({ method: "DELETE", url: `/api/tasks/${id}`, headers: headers(adminToken) });
  };

  it("defaults to null (keine Angabe) when not provided", async () => {
    const res = await createTask({ title: "Pomo Default" });
    expect(res.statusCode).toBe(201);
    expect(res.json().pomodoros).toBeNull();
    await deleteTask(res.json().id);
  });

  it("creates a task with pomodoros and includes them in list and detail", async () => {
    const res = await createTask({ title: "Pomo Task", pomodoros: 8 });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    expect(res.json().pomodoros).toBe(8);

    const list = await app.inject({ method: "GET", url: "/api/tasks", headers: headers(adminToken) });
    const item = (list.json().items as { id: string; pomodoros: number | null }[]).find((t) => t.id === id);
    expect(item?.pomodoros).toBe(8);

    const detail = await app.inject({ method: "GET", url: `/api/tasks/${id}`, headers: headers(adminToken) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().pomodoros).toBe(8);

    await deleteTask(id);
  });

  it("updates pomodoros and can clear them back to null", async () => {
    const res = await createTask({ title: "Pomo Update", pomodoros: 3 });
    const id = res.json().id;

    const upd = await app.inject({
      method: "PUT", url: `/api/tasks/${id}`,
      headers: headers(adminToken),
      payload: { pomodoros: 12 },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().pomodoros).toBe(12);

    const clear = await app.inject({
      method: "PUT", url: `/api/tasks/${id}`,
      headers: headers(adminToken),
      payload: { pomodoros: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().pomodoros).toBeNull();

    await deleteTask(id);
  });

  it("rejects invalid pomodoros (0, negative, float, >999)", async () => {
    for (const p of [0, -1, 2.5, 1000]) {
      const res = await createTask({ title: "Pomo Invalid", pomodoros: p });
      expect(res.statusCode).toBe(400);
    }
  });

  it("returns parentId when completing child task", async () => {
    const parent = await createTask({ title: "Parent" });
    expect(parent.statusCode).toBe(201);
    const pid = parent.json().id;

    const child = await createTask({ title: "Child", parentId: pid });
    expect(child.statusCode).toBe(201);
    const cid = child.json().id;

    const complete = await app.inject({
      method: "POST", url: `/api/tasks/${cid}/complete`,
      headers: headers(adminToken), payload: {},
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().parentId).toBe(pid);

    await deleteTask(cid);
    await deleteTask(pid);
  });

  it("blocks completion of parent with open subtasks and returns openCount", async () => {
    const parent = await createTask({ title: "BlockedParent" });
    expect(parent.statusCode).toBe(201);
    const pid = parent.json().id;

    await createTask({ title: "Child1", parentId: pid });
    await createTask({ title: "Child2", parentId: pid });

    const complete = await app.inject({
      method: "POST", url: `/api/tasks/${pid}/complete`,
      headers: headers(adminToken), payload: {},
    });
    expect(complete.statusCode).toBe(409);
    expect(complete.json().error.code).toBe("SUBTASKS_OPEN");
    expect(complete.json().error.openCount).toBe(2);

    await deleteTask(pid);
  });

  it("force-completes parent while leaving subtasks open", async () => {
    const parent = await createTask({ title: "ForceParent" });
    expect(parent.statusCode).toBe(201);
    const pid = parent.json().id;

    const child = await createTask({ title: "ForceChild", parentId: pid });
    expect(child.statusCode).toBe(201);
    const cid = child.json().id;

    const complete = await app.inject({
      method: "POST", url: `/api/tasks/${pid}/complete`,
      headers: headers(adminToken), payload: { force: true },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().completed).toBe(true);

    const pc = await app.inject({
      method: "GET", url: `/api/tasks/${pid}`, headers: headers(adminToken),
    });
    expect(pc.json().isCompleted).toBe(true);

    const cc = await app.inject({
      method: "GET", url: `/api/tasks/${cid}`, headers: headers(adminToken),
    });
    expect(cc.json().isCompleted).toBe(false);

    await deleteTask(cid);
    await deleteTask(pid);
  });

  it("cascade-completes all descendant subtasks", async () => {
    const parent = await createTask({ title: "CascadeParent" });
    expect(parent.statusCode).toBe(201);
    const pid = parent.json().id;

    const child1 = await createTask({ title: "CChild1", parentId: pid });
    expect(child1.statusCode).toBe(201);
    const cid1 = child1.json().id;

    const child2 = await createTask({ title: "CChild2", parentId: pid });
    expect(child2.statusCode).toBe(201);
    const cid2 = child2.json().id;

    const nested = await createTask({ title: "Grandchild", parentId: cid1 });
    expect(nested.statusCode).toBe(201);
    const nid = nested.json().id;

    const complete = await app.inject({
      method: "POST", url: `/api/tasks/${pid}/complete`,
      headers: headers(adminToken), payload: { cascade: true },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().completed).toBe(true);

    for (const id of [pid, cid1, cid2, nid]) {
      const r = await app.inject({
        method: "GET", url: `/api/tasks/${id}`, headers: headers(adminToken),
      });
      expect(r.json().isCompleted, `task ${id} not completed`).toBe(true);
    }

    await deleteTask(pid);
  });

  it("cascade-completes only non-recurring subtasks", async () => {
    const parent = await createTask({ title: "MixedParent" });
    expect(parent.statusCode).toBe(201);
    const pid = parent.json().id;

    const now = new Date();
    const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const rruleChild = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(adminToken),
      payload: { title: "RRuleChild", parentId: pid, recurrenceType: "rrule", recurrenceRule: "FREQ=WEEKLY;INTERVAL=1", dueAt: baseDate },
    });
    expect(rruleChild.statusCode).toBe(201);
    const rcid = rruleChild.json().id;

    const normalChild = await createTask({ title: "NormalChild", parentId: pid });
    expect(normalChild.statusCode).toBe(201);
    const ncid = normalChild.json().id;

    const nextOcc = new Date(baseDate);
    nextOcc.setDate(nextOcc.getDate() + 7);
    const occIso = nextOcc.toISOString();

    const complete = await app.inject({
      method: "POST", url: `/api/tasks/${pid}/complete`,
      headers: headers(adminToken),
      payload: { cascade: true, recurringCompletions: { [rcid]: occIso } },
    });
    expect(complete.statusCode).toBe(200);

    const rr = await app.inject({
      method: "GET", url: `/api/tasks/${rcid}`, headers: headers(adminToken),
    });
    expect(rr.json().isCompleted).toBe(false);

    const nr = await app.inject({
      method: "GET", url: `/api/tasks/${ncid}`, headers: headers(adminToken),
    });
    expect(nr.json().isCompleted).toBe(true);

    await deleteTask(pid);
  });

  it("upcoming-occurrences returns annotated RRULE dates", async () => {
    const now = new Date();
    const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const task = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(adminToken),
      payload: { title: "RRuleTest", recurrenceType: "rrule", recurrenceRule: "FREQ=WEEKLY;INTERVAL=1", dueAt: baseDate },
    });
    expect(task.statusCode).toBe(201);
    const tid = task.json().id;

    const res = await app.inject({
      method: "GET", url: `/api/tasks/${tid}/upcoming-occurrences?count=4`,
      headers: headers(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const occurrences = res.json();
    expect(Array.isArray(occurrences)).toBe(true);
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    expect(occurrences[0].iso).toBeDefined();
    expect(occurrences[0].isCompleted).toBe(false);

    await deleteTask(tid);
  });

  it("completes RRULE task with occurrenceDate tracking", async () => {
    const now = new Date();
    const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const task = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(adminToken),
      payload: { title: "OccTrack", recurrenceType: "rrule", recurrenceRule: "FREQ=WEEKLY;INTERVAL=1", dueAt: baseDate },
    });
    expect(task.statusCode).toBe(201);
    const tid = task.json().id;

    const occRes = await app.inject({
      method: "GET", url: `/api/tasks/${tid}/upcoming-occurrences?count=1`,
      headers: headers(adminToken),
    });
    const next = occRes.json()[0];

    const complete = await app.inject({
      method: "POST", url: `/api/tasks/${tid}/complete`,
      headers: headers(adminToken),
      payload: { occurrenceDate: next.iso },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().completed).toBe(true);

    const occs = await app.inject({
      method: "GET", url: `/api/tasks/${tid}/occurrences`,
      headers: headers(adminToken),
    });
    const rows = occs.json();
    expect(rows.filter((r: { isCompleted: boolean }) => r.isCompleted).length).toBe(1);

    await deleteTask(tid);
  });

  it("blocks recurrence rule change when planned occurrences exist", async () => {
    const now = new Date();
    const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const task = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(adminToken),
      payload: { title: "RecBlock", recurrenceType: "rrule", recurrenceRule: "FREQ=WEEKLY;INTERVAL=1", dueAt: baseDate },
    });
    expect(task.statusCode).toBe(201);
    const tid = task.json().id;

    const occRes = await app.inject({
      method: "GET", url: `/api/tasks/${tid}/upcoming-occurrences?count=1`,
      headers: headers(adminToken),
    });
    const occDate = occRes.json()[0].iso;
    const planDate = new Date().toISOString();

    await app.inject({
      method: "POST", url: `/api/tasks/${tid}/occurrences`,
      headers: headers(adminToken),
      payload: { occurrenceDate: occDate, plannedDate: planDate },
    });

    const update = await app.inject({
      method: "PUT", url: `/api/tasks/${tid}`,
      headers: headers(adminToken),
      payload: { recurrenceRule: "FREQ=DAILY;INTERVAL=1" },
    });
    expect(update.statusCode).toBe(409);
    expect(update.json().error.code).toBe("WILL_DELETE_PLANNED_OCCURRENCES");

    const forceUpdate = await app.inject({
      method: "PUT", url: `/api/tasks/${tid}`,
      headers: headers(adminToken),
      payload: { recurrenceRule: "FREQ=DAILY;INTERVAL=1", forceUpdateRecurrence: true },
    });
    expect(forceUpdate.statusCode).toBe(200);

    await deleteTask(tid);
  });

  it("stores the completed occurrence date in the task event timeline", async () => {
    const now = new Date();
    const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const task = await app.inject({
      method: "POST", url: "/api/tasks",
      headers: headers(adminToken),
      payload: { title: "EventOcc", recurrenceType: "rrule", recurrenceRule: "FREQ=WEEKLY;INTERVAL=1", dueAt: baseDate },
    });
    expect(task.statusCode).toBe(201);
    const tid = task.json().id;

    const occRes = await app.inject({
      method: "GET", url: `/api/tasks/${tid}/upcoming-occurrences?count=1`,
      headers: headers(adminToken),
    });
    const occIso = occRes.json()[0].iso;

    const complete = await app.inject({
      method: "POST", url: `/api/tasks/${tid}/complete`,
      headers: headers(adminToken),
      payload: { occurrenceDate: occIso, comment: "erledigt heute" },
    });
    expect(complete.statusCode).toBe(200);

    const events = await app.inject({
      method: "GET", url: `/api/tasks/${tid}/events`,
      headers: headers(adminToken),
    });
    const list = events.json();
    expect(list.length).toBeGreaterThan(0);
    const completed = list.find((e: { type: string }) => e.type === "completed");
    expect(completed).toBeDefined();
    expect(completed.occurrenceDate).toBeDefined();
    expect(new Date(completed.occurrenceDate).toISOString().slice(0, 10)).toBe(occIso.slice(0, 10));

    await deleteTask(tid);
  });
});

describe("Due date constraints (parent/subtask)", () => {
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString();

  const create = async (payload: Record<string, unknown>, token = adminToken) =>
    app.inject({ method: "POST", url: "/api/tasks", headers: headers(token), payload });

  const get = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/tasks/${id}`, headers: headers(adminToken) });
    return res.json();
  };

  const put = async (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: `/api/tasks/${id}`, headers: headers(adminToken), payload });

  const del = async (id: string) => {
    await app.inject({ method: "DELETE", url: `/api/tasks/${id}`, headers: headers(adminToken) });
  };

  it("blocks creating a subtask due after its parent", async () => {
    const parent = await create({ title: "P1", dueAt: iso(2026, 1, 10) });
    expect(parent.statusCode).toBe(201);
    const child = await create({ title: "C1", parentId: parent.json().id, dueAt: iso(2026, 1, 15) });
    expect(child.statusCode).toBe(409);
    expect(child.json().error.code).toBe("SUBTASK_DUE_CONFLICT");
    expect(child.json().error.conflicts.length).toBeGreaterThan(0);
    await del(parent.json().id);
  });

  it("allows a subtask due on the same day as its parent", async () => {
    const parent = await create({ title: "P2", dueAt: iso(2026, 1, 10) });
    const child = await create({ title: "C2", parentId: parent.json().id, dueAt: iso(2026, 1, 10) });
    expect(child.statusCode).toBe(201);
    await del(child.json().id);
    await del(parent.json().id);
  });

  it("allows a subtask with a due date when the parent has none", async () => {
    const parent = await create({ title: "P3" });
    const child = await create({ title: "C3", parentId: parent.json().id, dueAt: iso(2026, 1, 15) });
    expect(child.statusCode).toBe(201);
    await del(child.json().id);
    await del(parent.json().id);
  });

  it("forces creating a conflicting subtask with forceDueDate", async () => {
    const parent = await create({ title: "P4", dueAt: iso(2026, 1, 10) });
    const child = await create({ title: "C4", parentId: parent.json().id, dueAt: iso(2026, 1, 15), forceDueDate: true });
    expect(child.statusCode).toBe(201);
    expect(child.json().dueAt.slice(0, 10)).toBe("2026-01-15");
    await del(child.json().id);
    await del(parent.json().id);
  });

  it("resolve pushes the parent's due date forward on create", async () => {
    const parent = await create({ title: "P5", dueAt: iso(2026, 1, 10) });
    const pid = parent.json().id;
    const child = await create({ title: "C5", parentId: pid, dueAt: iso(2026, 1, 15), resolveDueDateConflicts: true });
    expect(child.statusCode).toBe(201);
    const updatedParent = await get(pid);
    expect(updatedParent.dueAt.slice(0, 10)).toBe("2026-01-15");
    await del(child.json().id);
    await del(pid);
  });

  it("blocks updating a subtask due after its parent and resolves by pushing the parent", async () => {
    const parent = await create({ title: "P6", dueAt: iso(2026, 1, 10) });
    const pid = parent.json().id;
    const child = await create({ title: "C6", parentId: pid, dueAt: iso(2026, 1, 5) });
    const cid = child.json().id;

    const blocked = await put(cid, { dueAt: iso(2026, 1, 12) });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("SUBTASK_DUE_CONFLICT");

    const resolved = await put(cid, { dueAt: iso(2026, 1, 12), resolveDueDateConflicts: true });
    expect(resolved.statusCode).toBe(200);
    const updatedParent = await get(pid);
    expect(updatedParent.dueAt.slice(0, 10)).toBe("2026-01-12");

    await del(cid);
    await del(pid);
  });

  it("forces updating a parent earlier than a child with forceDueDate", async () => {
    const parent = await create({ title: "P7", dueAt: iso(2026, 1, 10) });
    const pid = parent.json().id;
    const child = await create({ title: "C7", parentId: pid, dueAt: iso(2026, 1, 8) });
    const cid = child.json().id;

    const forced = await put(pid, { dueAt: iso(2026, 1, 5), forceDueDate: true });
    expect(forced.statusCode).toBe(200);
    const unchangedChild = await get(cid);
    expect(unchangedChild.dueAt.slice(0, 10)).toBe("2026-01-08");

    await del(cid);
    await del(pid);
  });

  it("blocks moving a parent earlier than a child and resolves by clamping the child", async () => {
    const parent = await create({ title: "P8", dueAt: iso(2026, 1, 10) });
    const pid = parent.json().id;
    const child = await create({ title: "C8", parentId: pid, dueAt: iso(2026, 1, 8) });
    const cid = child.json().id;

    const blocked = await put(pid, { dueAt: iso(2026, 1, 5) });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("SUBTASK_DUE_CONFLICT");

    const resolved = await put(pid, { dueAt: iso(2026, 1, 5), resolveDueDateConflicts: true });
    expect(resolved.statusCode).toBe(200);
    const updatedChild = await get(cid);
    expect(updatedChild.dueAt.slice(0, 10)).toBe("2026-01-05");

    await del(cid);
    await del(pid);
  });

  it("blocks moving a task under a parent with an earlier due date and resolves by pushing the chain", async () => {
    const parent = await create({ title: "P9", dueAt: iso(2026, 1, 10) });
    const pid = parent.json().id;
    const mover = await create({ title: "M9", dueAt: iso(2026, 1, 12) });
    const mid = mover.json().id;

    const blocked = await put(mid, { parentId: pid });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("SUBTASK_DUE_CONFLICT");

    const resolved = await put(mid, { parentId: pid, resolveDueDateConflicts: true });
    expect(resolved.statusCode).toBe(200);
    const updatedParent = await get(pid);
    expect(updatedParent.dueAt.slice(0, 10)).toBe("2026-01-12");

    await del(mid);
    await del(pid);
  });

  it("enforces the constraint across the whole ancestor chain (grandparent)", async () => {
    const grandparent = await create({ title: "GP10", dueAt: iso(2026, 1, 10) });
    const gpid = grandparent.json().id;
    const parent = await create({ title: "P10", parentId: gpid });
    const pid = parent.json().id;
    const grandchild = await create({ title: "GC10", parentId: pid, dueAt: iso(2026, 1, 15) });
    expect(grandchild.statusCode).toBe(409);
    expect(grandchild.json().error.code).toBe("SUBTASK_DUE_CONFLICT");

    await del(pid);
    await del(gpid);
  });

  it("uses the rrule baseDate as the parent's due date for the constraint", async () => {
    const parent = await create({ title: "P11", recurrenceType: "rrule", recurrenceRule: "FREQ=WEEKLY;INTERVAL=1", dueAt: iso(2026, 1, 10) });
    const pid = parent.json().id;
    const child = await create({ title: "C11", parentId: pid, dueAt: iso(2026, 1, 15) });
    expect(child.statusCode).toBe(409);

    const resolved = await create({ title: "C11b", parentId: pid, dueAt: iso(2026, 1, 15), resolveDueDateConflicts: true });
    expect(resolved.statusCode).toBe(201);
    const updatedParent = await get(pid);
    expect(updatedParent.baseDate.slice(0, 10)).toBe("2026-01-15");

    await del(resolved.json().id);
    await del(pid);
  });
});

describe("Task colors", () => {
  const cat = async (name: string, color: string) => {
    const res = await app.inject({
      method: "POST", url: "/api/categories", headers: headers(adminToken), payload: { name, color },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  };

  const create = async (payload: Record<string, unknown>) => {
    const res = await app.inject({ method: "POST", url: "/api/tasks", headers: headers(adminToken), payload });
    expect(res.statusCode).toBe(201);
    return res.json();
  };

  const del = async (id: string) => {
    await app.inject({ method: "DELETE", url: `/api/tasks/${id}`, headers: headers(adminToken) });
  };

  it("assigns a random hue in [0, 360) when no category is selected", async () => {
    const t = await create({ title: "NoCat Color" });
    expect(t.colorHue).toBeTypeOf("number");
    expect(t.colorHue).toBeGreaterThanOrEqual(0);
    expect(t.colorHue).toBeLessThan(360);
    await del(t.id);
  });

  it("assigns a green tone for a green category", async () => {
    const greenCat = await cat("Green Color", "#2d8c4a");
    const t = await create({ title: "Green Task", categoryIds: [greenCat] });
    expect(t.colorHue).toBeGreaterThanOrEqual(90);
    expect(t.colorHue).toBeLessThanOrEqual(180);
    await del(t.id);
    await app.inject({ method: "DELETE", url: `/api/categories/${greenCat}`, headers: headers(adminToken) });
  });

  it("recomputes the hue when categories change", async () => {
    const greenCat = await cat("Green Recolor", "#2d8c4a");
    const redCat = await cat("Red Recolor", "#c43e2c");
    const t = await create({ title: "Recolor Task", categoryIds: [greenCat] });
    expect(t.colorHue).toBeGreaterThanOrEqual(90);
    expect(t.colorHue).toBeLessThanOrEqual(180);

    const updated = await app.inject({
      method: "PUT", url: `/api/tasks/${t.id}`, headers: headers(adminToken), payload: { categoryIds: [redCat] },
    });
    expect(updated.statusCode).toBe(200);
    const hue = updated.json().colorHue;
    expect(hue >= 342 || hue <= 32).toBe(true);

    await del(t.id);
    await app.inject({ method: "DELETE", url: `/api/categories/${greenCat}`, headers: headers(adminToken) });
    await app.inject({ method: "DELETE", url: `/api/categories/${redCat}`, headers: headers(adminToken) });
  });
});
