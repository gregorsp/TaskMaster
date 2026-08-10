import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  profilePicture: text("profile_picture"),
  capacity: text("capacity"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  createdById: text("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  dueAt: integer("due_at", { mode: "timestamp_ms" }),
  baseDate: integer("base_date", { mode: "timestamp_ms" }),
  lastCompletedAt: integer("last_completed_at", { mode: "timestamp_ms" }),
  isCompleted: integer("is_completed", { mode: "boolean" }).notNull().default(false),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  completedById: text("completed_by_id").references(() => users.id),
  isImportant: integer("is_important", { mode: "boolean" }).notNull().default(false),
  isUrgent: integer("is_urgent", { mode: "boolean" }).notNull().default(false),
  pomodoros: integer("pomodoros"),
  urgencyMode: text("urgency_mode").notNull().default("before_days"),
  urgencyValue: integer("urgency_value"),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false),
  recurrenceType: text("recurrence_type").notNull().default("none"),
  recurrenceRule: text("recurrence_rule"),
  createdById: text("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const taskAssignees = sqliteTable(
  "task_assignees",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.userId] })]
);

export const taskCategories = sqliteTable(
  "task_categories",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.categoryId] })]
);

export const taskEvents = sqliteTable("task_events", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  type: text("type").notNull(),
  content: text("content"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
