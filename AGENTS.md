# AGENTS.md

## Architecture

- **Monorepo** with two packages: `server/` (Fastify + TypeScript) and `web/` (React + Vite). No npm workspaces — each package has its own `package.json` and `node_modules`.
- The Fastify server doubles as the SPA host in production: it serves the built React app from `server/public/` (copied from `web/dist/` during Docker build) and falls back to `index.html` for client-side routing.
- DB is SQLite via `sql.js` (WASM, no native modules). Drizzle ORM for schema + queries. Migrations are in `server/src/db/migrations/`.
- Current schema version: `SCHEMA_VERSION = 9` (defined in `server/src/db/version.ts`). There are 12 migration files (`0000` through `0011`).

### Server startup flow

Defined in `server/src/index.ts`:

1. `initDb()` — initializes the sql.js WASM engine and loads/creates the DB file.
2. `getDbState()` — reads the `app_meta` table for `schema_version`; also checks for `__drizzle_migrations` as a fallback. Returns one of four states:
   - `FRESH` — no schema at all → applies all migrations and seeds the admin user.
   - `UP_TO_DATE` — `version == SCHEMA_VERSION` → normal startup.
   - `MIGRATION_NEEDED` — `version < SCHEMA_VERSION` → either auto-migrates (`AUTO_MIGRATE=true`) or starts in maintenance mode.
   - `AHEAD_OF_APP` — DB version is higher than the app → refuses to start (exit 1).
3. In maintenance mode (`MIGRATION_NEEDED` + `!autoMigrate`), only the `/api/migration` routes are registered; all other API modules are disabled. The frontend shows a `MigrationPage` with a login form and a migration trigger.
4. Auto-save: `startAutoSave()` periodically serializes the in-memory sql.js DB back to the SQLite file on disk.
5. Graceful shutdown on `SIGINT`/`SIGTERM`: stops auto-save, saves the DB to disk, closes the DB handle.

### App assembly (`server/src/app.ts`)

- Registers plugins in order: `fastifyCookie`, `fastifyCors` (origin: `localhost:5173` in dev, `true` in prod), `fastifyJwt`, `fastifyMultipart` (20 MB limit).
- Registers a custom JSON content-type parser that handles empty bodies gracefully.
- Sets the global error handler (`middleware/error.handler.ts`) which maps known errors (Zod validation, Fastify errors, custom errors with `statusCode`/`code`) to the uniform `{ error: { code, message } }` shape.
- Defines inline routes: `GET /api/health` (returns status, version, schemaVersion, migrationRequired), `GET /api/avatars/:filename` (serves profile pictures with path traversal protection and caching).
- Registers all module route plugins under `/api/*` prefixes. In migration mode, only `/api/migration` is registered.
- If `public/` directory exists (production), registers `fastifyStatic` and a catch-all `setNotFoundHandler` that serves `index.html` for client-side routing.

## Development commands

```bash
# Backend (port 8080)
cd server
npm install
npm run db:migrate    # apply all migrations
npm run db:seed       # seed admin user (admin@taskmaster.local / admin123)
npm run dev           # tsx watch — hot reload

# Frontend (port 5173, proxies /api → 8080)
cd web
npm install
npm run dev           # Vite dev server

# Run all server tests (Vitest, in-memory DB)
cd server && npm test

# Watch mode
cd server && npm run test:watch

# Database schema changes
cd server && npm run db:generate   # creates migration from schema.ts changes
```

## Quality checks before PR

```bash
cd server && npm run build && npm test
cd web && npm run build    # tsc -b + vite build (includes PWA generation)
```

No linter or formatter configured — only `tsc` typecheck and `vitest` tests.

## Server module structure

All business logic lives under `server/src/modules/`, organized by domain:

| Module | Directory | Route prefix | Key files |
|---|---|---|---|
| Auth | `modules/auth/` | `/api/auth` | `auth.routes.ts`, `auth.service.ts`, `auth.schema.ts`, `profile.service.ts` |
| Tasks | `modules/tasks/` | `/api/tasks` | `tasks.routes.ts`, `tasks.service.ts`, `tasks.schema.ts`, `completion.service.ts` |
| Categories | `modules/categories/` | `/api/categories` | `categories.routes.ts`, `categories.service.ts`, `colors.ts` |
| Users | `modules/users/` | `/api/users` | `users.routes.ts`, `users.service.ts` |
| Calendar | `modules/calendar/` | `/api/calendar` | `calendar.routes.ts`, `recurrence.service.ts` |
| Planning | `modules/planning/` | `/api/planning` | `planning.routes.ts`, `planning.service.ts` |
| Daily | `modules/daily/` | `/api/daily` | `daily.routes.ts`, `daily.service.ts` |
| Migration | `modules/migration/` | `/api/migration` | `migration.routes.ts` |

Each module follows a consistent pattern:
- **`*.routes.ts`** — Fastify plugin exporting an async function that registers routes on the app instance. Routes use `authGuard` as a `preHandler` hook (applied once per plugin via `app.addHook("preHandler", authGuard)`).
- **`*.service.ts`** — Pure functions that operate on the Drizzle DB instance from `getDb()`. No HTTP concerns.
- **`*.schema.ts`** (optional) — Zod schemas for request body/query validation.

### Middleware (`server/src/middleware/`)

| File | Purpose |
|---|---|
| `auth.hooks.ts` | Exports `authGuard` (verifies JWT from `Authorization: Bearer` header, populates `request.user` with `{ id, isAdmin }`) and `adminGuard` (checks `request.user.isAdmin`). |
| `visibility.ts` | Exports `isVisibleToUser(taskId, userId, isAdmin)` — returns false for tasks the user should not see (private tasks where user is neither creator, assignee, nor admin). Also exports `buildVisibilityClause` used by the task list query to filter at the SQL level. |
| `error.handler.ts` | Fastify `setErrorHandler` that normalizes all errors to `{ error: { code, message } }`. Handles Zod validation errors (400), Fastify validation errors (400), and custom errors with `statusCode`/`code`. |

## Route registration and auth flow

- All routes live in their module's `*.routes.ts` file and are registered in `app.ts` with a prefix (e.g., `app.register(tasksRoutes, { prefix: "/api/tasks" })`).
- Each route plugin calls `app.addHook("preHandler", authGuard)` which runs before every route in that plugin. This means **every route** under `/api/tasks`, `/api/categories`, etc. requires authentication.
- The only public endpoints are `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/health`, and `/api/avatars/:filename`.
- Auth flow: `POST /api/auth/login` returns `{ accessToken, user }` in the body and sets a `refreshToken` HttpOnly cookie (path-scoped to `/api/auth/refresh`). The web app's Axios client (`web/src/api/client.ts`) attaches the access token as a Bearer header and has a 401 interceptor that calls `/api/auth/refresh` to get a new access token transparently.
- Refresh cookie settings: `httpOnly: true`, `sameSite: "lax"`, `secure: isProd`, `path: "/api/auth/refresh"`, `maxAge: 7 days`.

## Database schema and migrations

### Schema overview (`server/src/db/schema.ts`)

9 Drizzle tables:

| Table | Purpose |
|---|---|
| `users` | User accounts: id, username, email, passwordHash, displayName, isAdmin, profilePicture, capacity, confirmHabitCompletion, createdAt |
| `tasks` | Tasks with 25 columns including: title, description, dueAt, baseDate, lastCompletedAt, isCompleted, completedAt, isImportant, isUrgent, pomodoros, urgencyMode, urgencyValue, isPrivate, isHabit, recurrenceType, recurrenceRule, parentId, plannedDate |
| `task_assignees` | Join table: taskId ↔ userId (composite PK) |
| `task_categories` | Join table: taskId ↔ categoryId (composite PK) |
| `task_events` | Audit log: id, taskId, userId, type (completed/reopened/comment), content, occurrenceDate, createdAt |
| `task_links` | Bidirectional task relationships: taskIdA ↔ taskIdB (composite PK) |
| `task_occurrences` | Individual recurrence instances: id, taskId, occurrenceDate, plannedDate, isCompleted, completedAt, completedById, note, createdAt |
| `categories` | Task categories: id, name, color, createdById, createdAt |
| `app_meta` | Key-value store for app metadata (currently only `schema_version`) |

### Migration workflow

When changing `server/src/db/schema.ts`:
1. `cd server && npm run db:generate` → creates a new `.sql` file in `src/db/migrations/` (auto-named like `0012_some_slug.sql`).
2. **Bump `SCHEMA_VERSION`** in `server/src/db/version.ts` (e.g., from `9` to `10`).
3. If the migration inserts data (e.g., a new default category), add `INSERT`/`UPDATE` statements by hand to the generated `.sql` file.
4. Write a migration test in `server/test/migration.test.ts`. The existing pattern: create a mock DB with the schema at version N-1, load the app schema, verify the migration upgrades it correctly.
5. **Never modify or delete an already-released migration file.** The Docker image ships the full migration history. Modifying an old migration would break existing databases that have already applied it.

### Migration runtime (`server/src/db/migrations.ts`)

- `runMigration()` reads all `.sql` files from the migrations directory in order and applies them to the current DB.
- `createBackup()` serializes the current sql.js DB to a `.sqlite` file in the backup directory before migration, with pruning of old backups (keeps at most `BACKUP_KEEP` files).
- `restoreDb(path)` restores the DB from a backup file if migration fails.

## Key design patterns and quirks

### sql.js (WASM) database

- **`sql.js` not `better-sqlite3`** — the WASM SQLite driver means no native compilation, critical for ARM64/Raspberry Pi, but changes how the DB connection is initialized (via `initSqlJs` async).
- The DB is held **in memory** as a sql.js object. The `DB_PATH` file is loaded into memory at startup and periodically flushed back to disk via `startAutoSave()`. This means:
  - All DB operations are synchronous and fast (in-memory).
  - The `getDb()` function returns a shared singleton Drizzle DB instance. Never create a new DB connection; always use `getDb()`.
  - In tests, `DB_PATH` is overridden to `:memory:` to avoid file I/O.

### Private tasks visibility

- Private tasks (`isPrivate = true`) are **server-filtered**. The `visibility.ts` middleware adds a WHERE clause to all task queries: the user must be the creator, an assignee, or an admin.
- **Never replicate this logic on the frontend** — it's authoritative on the server. The frontend just receives already-filtered data.

### JWT refresh is cookie-based

- The refresh token is an **HttpOnly cookie** (not in `localStorage`), making it inaccessible to JavaScript and resistant to XSS.
- The web app uses an Axios interceptor (`web/src/api/client.ts`) to auto-refresh on 401 responses.
- The interceptor queues concurrent requests during a refresh to avoid multiple simultaneous refresh calls.

### RRULE recurrence is computed at runtime

- Recurring tasks store only the **RRULE string** and **base date**. The calendar endpoint and overdue detection expand rules on the fly using the `rrule` library (RFC 5545).
- New: **Task occurrences** (`task_occurrences` table) allow individual recurrence instances to be tracked independently — completed, skipped, or rescheduled. The `GET /api/tasks/:id/upcoming-occurrences` endpoint returns the next N occurrences (computed from RRULE, then cross-referenced with the occurrences table for manual overrides).

### Task completion flow

- `POST /api/tasks/:id/complete` supports multiple modes:
  - **Normal**: marks the task completed, creates a task event.
  - **`force`**: completes even if subtasks are open (for habits or admin override).
  - **`cascade`**: completes the task and all open subtasks recursively.
  - **`occurrenceDate`**: for recurring tasks, specifies which occurrence date was completed (used by the daily view for habit tracking).
  - **`recurringCompletions`**: batch-complete multiple past occurrences at once (for habits).
- Recurrence type `none`: task stays completed.
- Recurrence type `rrule`: task generates the next occurrence based on the RRULE.
- Recurrence type `on_completion`: user specifies `nextDueAt` in the completion request.
- **Habits** (`isHabit = true`): special recurring tasks. Completion requires explicit confirmation (toggled per user via `confirmHabitCompletion`). The daily view shows habit completion streaks and tracks which days were completed/skipped.

### Task hierarchy

- Tasks can have a **parent** via the `parentId` field. Child tasks are called **subtasks**.
- A task **cannot be completed** if it has open (uncompleted) subtasks, unless `force` or `cascade` is used.
- A task **cannot be deleted** if it has open subtasks (returns 409 with `code: "HAS_OPEN_SUBTASKS"`).
- `GET /api/tasks/:id/subtasks` returns direct children. `GET /api/tasks/:id/siblings` returns tasks sharing the same parent.

### Task links

- Bidirectional directional links between any two tasks (stored in `task_links`).
- Frontend visualizes these as an interactive directed acyclic graph using **@xyflow/react** and **dagre**.
- `GET /api/tasks/:id/links` returns all linked tasks. `POST /api/tasks/:id/links` creates a link (with self-link prevention and visibility checks). `DELETE /api/tasks/:id/links/:linkedTaskId` removes a link.

### Urgency modes

- Tasks have an `urgencyMode` field: `"before_days"` (default) or `"fixed_date"`.
- `before_days`: task becomes urgent `urgencyValue` days before its due date.
- `fixed_date`: task becomes urgent on the specific date in `urgencyValue` (as a timestamp).
- This is used by the Eisenhower matrix and the daily view to surface tasks that are becoming urgent.

### Planning system

- `GET /api/planning?from=&to=&userId?` returns a weekly grid of tasks with planned dates. Admins can view any user's plan by passing `userId`.
- The planning view uses a **draft/confirm** workflow:
  - `PUT /api/planning/draft` saves changes as draft entries (stored in the tasks table as `plannedDate`).
  - `DELETE /api/planning/draft` discards all draft changes.
  - `POST /api/planning/confirm` finalizes the planning.
- User **capacity** (`capacity` field on users, stored as JSON with `{ hoursPerDay: number, daysPerWeek: number[] }`) is displayed in the planning view to show workload against capacity.

### Daily view

- `GET /api/daily?date=YYYY-MM-DD` aggregates:
  - Habits (with completion status for the given date, using `task_occurrences` for tracking).
  - Tasks due on that date.
  - Upcoming occurrences for recurring tasks.
  - Overdue tasks.

### Profile pictures

- Uploaded via `POST /api/auth/me/profile-picture` (multipart, processed with `sharp` for resizing/compression).
- Stored on disk in `config.avatarsDir` (defaults to `<DB_PATH>/avatars`).
- Served via `GET /api/avatars/:filename` with path traversal protection and 24h caching.

### PWA service worker

- Generated by `vite-plugin-pwa` during `npm run build` in web.
- Can cache stale files during development — **hard-reload (Ctrl+Shift+R) or disable SW in DevTools** when testing frontend changes.
- The service worker only activates in production builds; dev mode (`npm run dev`) does not register it.

### Frontend data fetching

- Uses **@tanstack/react-query** for server state management (caching, refetching, optimistic updates).
- Axios clients in `web/src/api/` wrap each API endpoint. The base client in `client.ts` handles JWT attachment and 401 refresh logic.
- `AuthContext` in `web/src/context/AuthContext.tsx` manages user session state and provides `login`, `register`, `logout`, `refreshUser` functions.
- `ThemeContext` persists dark/light mode preference in `localStorage`.
- `NotifyContext` provides a global snackbar/notification system.

### Frontend component structure

- `web/src/components/layout/AppShell.tsx` — main layout with sidebar navigation, header (with overdue badge, dark mode toggle, user menu).
- `web/src/components/tasks/` — most complex component area:
  - `TaskForm.tsx` — create/edit task dialog with recurrence, assignment, categories, urgency settings.
  - `TaskCard.tsx` / `TaskListView.tsx` — task display components.
  - `TaskTree/` — recursive tree component for parent/child task hierarchy.
  - `TaskGraphDialog.tsx` — interactive graph visualization of task links.
  - `TaskRelationsSidebar.tsx` — shows linked tasks in a side panel.
  - `LinkTaskDialog.tsx` — dialog for creating links.
  - `CompleteBlockedDialog.tsx` — shown when a task cannot be completed due to open subtasks.
  - `ForceCompleteDialog.tsx` — confirmation for force-completing (with cascade option).
  - `OccurrencePicker.tsx` — date picker for selecting occurrence dates.
  - `ModalStackProvider.tsx` / `ModalStackRenderer.tsx` — manages a stack of modals (used when task interactions chain, e.g., opening a link task from a task detail, then editing that linked task).
- `web/src/pages/` — one page component per route:
  - `DashboardPage` — main task list with filters.
  - `CalendarPage` — month/week calendar.
  - `MatrixPage` — Eisenhower matrix with drag-and-drop.
  - `DailyPage` — today's view (habits, tasks, occurrences).
  - `PlanningPage` — weekly planning grid.
  - `CategoriesPage` — category management.
  - `AdminPage` — user management (admin only).
  - `ProfilePage` — user's own profile settings.
  - `MigrationPage` — shown in maintenance mode.

## Environment and config

### Config validation (`server/src/config.ts`)

All environment variables are live-validated by **zod** at import time. Invalid values crash the process with a clear error on boot. Never catches; fail fast.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP port inside the container |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `./data/taskmaster.db` | Path to SQLite file; overridden to `:memory:` in test mode |
| `JWT_SECRET` | `change-me-in-production-123456` | Min 16 chars. **Must be set in production**. |
| `JWT_ACCESS_TTL` | `15m` | ms-format duration string |
| `JWT_REFRESH_TTL` | `7d` | ms-format duration string |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `AUTO_MIGRATE` | `true` (dev) / `false` (prod) | Auto-apply migrations on startup? `false` → maintenance mode |
| `BACKUP_DIR` | `<DB_PATH>/backups` | Directory for pre-migration backups |
| `BACKUP_KEEP` | `5` | Max number of backup files to retain |
| `ADMIN_EMAIL` | `admin@taskmaster.local` | Email for initial admin (read directly from `process.env` in `index.ts`, not via config) |
| `ADMIN_PASSWORD` | `admin123` | Password for initial admin (read directly from `process.env`) |

Key behaviors by `NODE_ENV`:
- `development`: CORS allows `http://localhost:5173`, verbose Fastify logging, refresh cookie NOT `secure`, `AUTO_MIGRATE` defaults to `true`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` defaults are used.
- `production`: CORS allows configured origin, reduced logging, refresh cookie `secure`, `AUTO_MIGRATE` defaults to `false`.
- `test`: DB is `:memory:`, avatarsDir/backupDir are empty strings (no file I/O).

The `.env` file is git-ignored; use `.env.example` as a template.

## Testing

### Test infrastructure

- **Framework**: Vitest (`server/package.json` → `"test": "vitest run"`, `"test:watch": "vitest"`).
- **Database**: In-memory SQLite (`DB_PATH` is `:memory:` when `NODE_ENV=test`).
- **HTTP**: Tests use Fastify's `inject()` method to call routes without a running server. Each test file builds a fresh app instance via `buildApp()` and seeds the necessary data.
- **Current coverage**: 102 tests across 9 test files.

### Test files

| File | Test count | What's covered |
|---|---|---|
| `test/tasks.test.ts` | 33 | Task CRUD, filtering, pagination, visibility, subtasks, links, occurrences, urgency |
| `test/migration.test.ts` | 16 | Migration from old schema versions, backup/restore |
| `test/habits.test.ts` | 14 | Habit creation, completion, occurrence tracking, streaks |
| `test/planning.test.ts` | 11 | Planning grid, draft/confirm, capacity |
| `test/capacity.test.ts` | 9 | User capacity CRUD, validation |
| `test/http-flow.test.ts` | 6 | HTTP status codes, error shapes, auth flow |
| `test/recurrence.test.ts` | 6 | RRULE expansion, completion recurrence calculation |
| `test/auth.test.ts` | 4 | Registration, login, token refresh, logout |
| `test/profile-update.test.ts` | 3 | Profile field updates, password changes |

### Running tests

```bash
cd server
npm test             # single run
npm run test:watch   # watch mode, re-runs on file changes
```

### Test patterns

- Each test file imports `buildApp` from `../src/app.js` and `getDb`/`initDb` from `../src/db/client.js`.
- Before each test: `initDb(":memory:")` resets the DB, applies all migrations, optionally seeds test data.
- After each test: cleanup if needed (the `:memory:` DB is discarded).
- Auth tests get tokens by calling `POST /api/auth/login` via `app.inject()` and extracting the `accessToken` from the response.
- Visibility tests verify that private tasks are invisible to unauthorized users via `GET /api/tasks/:id` returning 404.

## Docker / Deployment

### Dockerfile (3-stage build)

1. **web-build** (node:24-bookworm-slim): `npm ci` → `npm run build` → produces `web/dist/`.
2. **server-build** (node:24-bookworm-slim): `npm ci` → `npm run build` → produces `server/dist/` (TypeScript compiled to JS).
3. **runtime** (node:24-bookworm-slim): `npm ci --omit=dev`, copies `dist/` from server-build, migration `.sql` files, and `public/` from web-build. Creates `/app/data` directory. Exposes port 8080.

### Docker Compose

- Single service `taskmaster` using image `ghcr.io/gregorsp/taskmaster:latest` (multi-arch arm64/amd64).
- Volume `taskmaster_data` mounted at `/app/data` for SQLite persistence.
- Environment variables from `.env` file or direct values.
- Healthcheck: HTTP call to `/api/health`.
- `restart: unless-stopped`.

### CI/CD

- **`.github/workflows/ci.yml`**: Runs on push to `main` and PRs. Two jobs: `server` (build + test) and `web` (build only). Uses Node.js 24.
- **`.github/workflows/docker-publish.yml`**: Builds and pushes the multi-arch Docker image to GHCR.

### GHCR image

- `ghcr.io/gregorsp/taskmaster:latest` (multi-arch arm64/amd64).
- Built by GitHub Actions on push to main.
- Local build fallback: `docker compose up -d --build` uses the Dockerfile directly.

### Deployment modes

- **Normal mode**: All API routes registered, frontend served from `public/`.
- **Maintenance mode**: Only `/api/migration` and `/api/auth` routes registered. Frontend shows `MigrationPage` to trigger migration. Switches to normal mode after successful migration (requires restart currently — the migration runs in-process, so the app must be restarted after migration to re-register all routes).

## Common pitfalls

- **PWA cache in development**: After making frontend changes, the service worker may serve cached files. Do a hard reload (Ctrl+Shift+R) or disable the service worker in DevTools → Application → Service Workers.
- **sql.js async initialization**: Always `await initDb()` before any DB operations. The `getDb()` function returns the shared Drizzle instance — never try to create a new one.
- **Visibility filter**: When writing new task queries, always include the visibility clause from `buildVisibilityClause()` or call `isVisibleToUser()`. Missing this is a security bug.
- **Migration files are immutable**: Never edit an existing migration file. Always create a new one. Old migrations are the source of truth for the DB state they produce.
- **SCHEMA_VERSION must match**: If you forget to bump `SCHEMA_VERSION` after adding a migration, the server won't detect the migration and will start in maintenance mode or refuse to start.
- **Zod validation**: All user input in routes is validated with Zod schemas. Errors are caught by the global error handler and returned as 400 with `{ error: { code: "VALIDATION_ERROR", message: "...", issues: [...] } }`.
- **Content-type parser**: The custom JSON parser in `app.ts` handles empty bodies (`{}` instead of throwing). Routes that expect a body should still validate with Zod.
