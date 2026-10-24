import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  profilePicture: text("profile_picture"),
  capacity: text("capacity"),
  confirmHabitCompletion: integer("confirm_habit_completion", { mode: "boolean" }).notNull().default(true),
  transcriptionLanguage: text("transcription_language").notNull().default("de"),
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
  isHabit: integer("is_habit", { mode: "boolean" }).notNull().default(false),
  recurrenceType: text("recurrence_type").notNull().default("none"),
  recurrenceRule: text("recurrence_rule"),
  parentId: text("parent_id"),
  plannedDate: integer("planned_date", { mode: "timestamp_ms" }),
  createdById: text("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  slug: text("slug"),
}, (table) => [uniqueIndex("idx_tasks_slug_unique").on(table.slug)]);

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
  occurrenceDate: integer("occurrence_date", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const taskLinks = sqliteTable(
  "task_links",
  {
    taskIdA: text("task_id_a")
      .notNull()
      .references(() => tasks.id),
    taskIdB: text("task_id_b")
      .notNull()
      .references(() => tasks.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.taskIdA, table.taskIdB] })]
);

export const taskOccurrences = sqliteTable("task_occurrences", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  occurrenceDate: integer("occurrence_date", { mode: "timestamp_ms" }).notNull(),
  plannedDate: integer("planned_date", { mode: "timestamp_ms" }),
  isCompleted: integer("is_completed", { mode: "boolean" }).notNull().default(false),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  completedById: text("completed_by_id").references(() => users.id),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("idx_notes_user_created").on(table.userId, table.createdAt)]
);

export const recordings = sqliteTable(
  "recordings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    ordinal: integer("ordinal").notNull().default(0),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull().default(0),
    chunkCount: integer("chunk_count").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    language: text("language").notNull().default("de"),
    status: text("status").notNull().default("uploading"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("idx_recordings_owner").on(table.ownerType, table.ownerId)]
);

export const transcriptionJobs = sqliteTable(
  "transcription_jobs",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("pending"),
    progressMs: integer("progress_ms").notNull().default(0),
    claimedBy: text("claimed_by"),
    leaseUntil: integer("lease_until", { mode: "timestamp_ms" }),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_transcription_jobs_recording").on(table.recordingId),
    index("idx_transcription_jobs_user_status").on(table.userId, table.status),
  ]
);

export const transcriptSegments = sqliteTable(
  "transcript_segments",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id),
    idx: integer("idx").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    text: text("text").notNull(),
  },
  (table) => [uniqueIndex("idx_transcript_segments_recording_idx").on(table.recordingId, table.idx)]
);

export const journalQuestions = sqliteTable(
  "journal_questions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    text: text("text").notNull(),
    position: integer("position").notNull().default(0),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("idx_journal_questions_user").on(table.userId, table.position)]
);

export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    entryDate: text("entry_date").notNull(),
    text: text("text").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("idx_journal_entries_user_date").on(table.userId, table.entryDate)]
);

export const journalAnswers = sqliteTable(
  "journal_answers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    questionId: text("question_id")
      .notNull()
      .references(() => journalQuestions.id),
    answerDate: text("answer_date").notNull(),
    text: text("text").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_journal_answers_unique").on(table.userId, table.questionId, table.answerDate),
    index("idx_journal_answers_user_date").on(table.userId, table.answerDate),
  ]
);

export const meditationSessions = sqliteTable(
  "meditation_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    plannedDurationSec: integer("planned_duration_sec"),
    actualDurationSec: integer("actual_duration_sec").notNull().default(0),
    note: text("note"),
    concentration: integer("concentration"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("idx_meditation_user_started").on(table.userId, table.startedAt)]
);

export const meditationComments = sqliteTable(
  "meditation_comments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => meditationSessions.id),
    text: text("text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("idx_meditation_comments_session").on(table.sessionId, table.createdAt)]
);

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
