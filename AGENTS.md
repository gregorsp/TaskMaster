# AGENTS.md

## Architecture

- **Monorepo** with two packages: `server/` (Fastify + TypeScript) and `web/` (React + Vite). No npm workspaces — each package has its own `package.json` and `node_modules`.
- The Fastify server doubles as the SPA host in production: it serves the built React app from `server/public/` (copied from `web/dist/` during Docker build) and falls back to `index.html` for client-side routing.
- DB is SQLite via `sql.js` (WASM, no native modules). Drizzle ORM for schema + queries. Migrations are in `server/src/db/migrations/`.

## Development commands

```bash
# Backend (port 8080)
cd server
npm install
npm run db:migrate    # apply migrations
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
```

## Quality checks before PR

```bash
cd server && npm run build && npm test
cd web && npm run build    # tsc -b + vite build (includes PWA generation)
```

No linter or formatter configured — only `tsc` typecheck and `vitest` tests.

## Database migrations

When changing `server/src/db/schema.ts`:
1. `cd server && npm run db:generate` → creates new migration in `src/db/migrations/`
2. Bump `SCHEMA_VERSION` in `server/src/db/version.ts`
3. If the migration inserts data, add `INSERT`/`UPDATE` by hand to the generated `.sql` file
4. Write a migration test in `server/test/migration.test.ts`

**Never modify or delete an already-released migration file.** The Docker image ships the full migration history.

## Key quirks

- **No CI workflow in repo yet** — the README references `ci.yml` but `.github/workflows/` is empty. The badge in the README won't light up until CI is added.
- **`sql.js` not `better-sqlite3`** — the WASM SQLite driver means no native compilation, critical for ARM64/Raspberry Pi but changes how the DB connection is initialized (via `initSqlJs` async).
- **JWT refresh is cookie-based**: the refresh token is HttpOnly (not in `localStorage`). The web app uses an Axios interceptor (`web/src/api/`) to auto-refresh on 401.
- **Private tasks are server-filtered**: the backend middleware adds a visibility clause to all task queries. Don't replicate this logic on the frontend — it's authoritative on the server.
- **RRULE recurrence is computed at runtime**: recurring tasks store only the RRULE string + start date. The calendar endpoint and overdue detection expand rules on the fly.
- **PWA service worker** can cache stale files during development — hard-reload or disable SW in DevTools.

## Environment

- Config live-validated by zod in `server/src/config.ts`. Invalid values crash the process with a clear error on boot.
- `NODE_ENV=production` → Secure cookies, reduced logging, auto-migrate disabled by default.
- `AUTO_MIGRATE=true` lets unattended deploys run migrations without admin bootstrap UI.
- The `.env` file is git-ignored; use `.env.example` as a template.

## Docker / Deployment

- Multi-stage Dockerfile: web-build → server-build → runtime (node:24-bookworm-slim).
- Single container; SQLite file persists in Docker volume `taskmaster_data`.
- GHCR image: `ghcr.io/gregorsp/taskmaster:latest` (multi-arch arm64/amd64).
