# TaskMaster

> Shared task management for homelab families – with calendar, Eisenhower matrix, recurrences and PWA. Runs on a Raspberry Pi (ARM64) in a single Docker container.

![License](https://img.shields.io/github/license/gregorsp/TaskMaster)
![CI](https://img.shields.io/github/actions/workflow/status/gregorsp/TaskMaster/ci.yml?label=CI)
![Image](https://img.shields.io/badge/Image-ghcr.io%2Fgregorsp%2Ftaskmaster-informational)

[Deutsche Version](README.md)

---

## Table of contents

- [Features (implemented)](#features-implemented)
- [Roadmap (planned)](#roadmap-planned)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Quick start (development)](#quick-start-development)
- [Debugging](#debugging)
- [Tests](#tests)
- [Deployment (CasaOS / Raspberry Pi)](#deployment-casaos--raspberry-pi)
- [Configuration](#configuration)
- [API overview](#api-overview)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [AI assistance note](#ai-assistance-note)
- [License](#license)

---

## Features (implemented)

- **Users & roles** – Registration, login and admin roles; admins manage users (change role, delete)
- **Tasks** – Title, description, due date (date + optional time), multiple assignees, categories (tags)
- **Recurrences** – three types:
  - *One-off*: gets completed and stays done
  - *Recurring* (RRULE / RFC 5545): e.g. "every 2 weeks on Wednesday", "every 3rd Wednesday of the month", "always on the 1st of the month"
  - *On completion*: after completing, you set when the task should happen next
- **Visibility** – Private tasks are only visible to the creator, assignees and admins (server-side filter)
- **Calendar** – Month and week view including computed recurrence occurrences
- **Eisenhower matrix** – Drag & drop tasks into 4 quadrants (important/urgent)
- **Overdue tasks** – Red badge in the header (polling), dedicated page and a toast after login
- **Task history** – Timeline of who completed/reopened a task, plus per-task comments
- **Categories** – Color palette, custom color picker and automatic color with maximum distance to existing ones
- **Dark mode** – Light/dark toggle in the header (persisted in the browser)
- **PWA** – Installable as an app on your phone, offline caching via service worker
- **REST API** – JWT auth (15 min access token, 7 day refresh token as HttpOnly cookie)

## Roadmap (planned)

Not implemented yet, but planned:

- **Notifications** (email/push) for due and overdue tasks
- **iCal import/export** (near-trivial thanks to RRULE)
- **Sub-tasks / checklists**
- **Internationalization (i18n)** – the UI is currently German only
- **Task attachments** – attach files/notes to tasks

## Tech stack

| Area | Technology |
|---|---|
| Backend | Node.js 24 + TypeScript + Fastify |
| Database | SQLite via sql.js (WASM, no native modules) + Drizzle ORM |
| Migrations | Drizzle Kit |
| Frontend | React 19 + Vite + MUI 7 + Tailwind 4 |
| Auth | JWT (fastify-jwt) + scrypt + HttpOnly cookies |
| Recurrences | rrule (RFC 5545) |
| Drag & drop | dnd-kit |
| PWA | vite-plugin-pwa |
| Deployment | Docker (multi-arch: `linux/arm64` + `linux/amd64`), image on GHCR |

## Architecture

TaskMaster uses a **single-container design**:

- The Fastify server serves the REST API under `/api/*` **and** the built React app (SPA, fallback to `index.html`).
- The database is a SQLite **file** (no separate DB process) stored in the Docker volume `/app/data`.
- `sql.js` is a WebAssembly driver without native modules – so the image runs identically on **ARM64 (Raspberry Pi)** and AMD64, with no compile toolchain required.
- Recurrence logic is built on `rrule` (RFC 5545). Recurring tasks store their rule and start date; current/overdue dates are computed at runtime.

## Quick start (development)

Requirements: Node.js 24 + npm.

```bash
# 1. Start the backend
cd server
npm install
npm run db:migrate          # create the database schema
npm run db:seed             # create admin: admin@taskmaster.local / admin123
npm run dev                 # http://localhost:8080

# 2. Start the frontend (second terminal)
cd web
npm install
npm run dev                 # http://localhost:5173 (proxies /api to 8080)
```

## Debugging

- **Docker logs**: `docker compose logs -f taskmaster`
- **VS Code**: The repo ships `.vscode/launch.json` with two configurations – "Debug Server (tsx)" (hot reload) and "Debug Server (gebaut)".
- **Server logs**: Fastify/Pino emits structured JSON logs; more verbose in development mode.
- **Watch-mode tests**: `cd server && npm run test:watch`
- **Frontend**: Vite offers hot module replacement; use browser devtools to inspect API calls (bearer token) and auth cookies.
  - **PWA caveat**: after changes, hard-reload (Ctrl/Cmd+Shift+R) or disable the service worker in devtools so a stale cache doesn't get in the way.
- **Health check**: `curl http://localhost:8080/api/health` → `{"status":"ok"}`

## Tests

```bash
cd server
npm test        # Vitest with in-memory database (32 tests)
```

Covered: auth flow (login/refresh), task CRUD, private-task visibility, recurrence logic and categories.

## Deployment (CasaOS / Raspberry Pi)

There are two ways – for the Pi, **option A** is recommended (no build on the device).

### Option A: Pull a ready-made image from GHCR (recommended)

GitHub Actions builds a multi-arch image on every push and publishes it as
`ghcr.io/gregorsp/taskmaster:latest`. The Pi only downloads the finished image.

```bash
git clone https://github.com/gregorsp/TaskMaster.git
cd TaskMaster

# Create the configuration and set JWT_SECRET (see "Configuration")
cp .env.example .env
# Set JWT_SECRET in .env to a random value, e.g.:
#   openssl rand -hex 32

docker compose up -d
# → http://<pi-ip>:8080
```

**Under CasaOS**: import the compose file via "My Apps" or define it as your own app
(same content as `docker-compose.yml`). Host port, environment variables and volumes
can then be adjusted through the CasaOS UI.

**Update to a new version**:

```bash
git pull
docker compose pull && docker compose up -d
```

### Option B: Build from source

Without a registry, or before the first CI build – the image is built locally
(takes a few minutes on the Pi, depending on the model):

```bash
git clone https://github.com/gregorsp/TaskMaster.git
cd TaskMaster
cp .env.example .env        # set JWT_SECRET!
docker compose up -d --build
```

### First login

On the very first start, the server automatically creates an admin user if no users
exist yet:

- Email: `ADMIN_EMAIL` (default: `admin@taskmaster.local`)
- Password: `ADMIN_PASSWORD` (default: `admin123` – **change it in production!**)

### Reverse proxy / TLS (recommended)

CasaOS commonly ships Caddy or Traefik as a reverse proxy. That lets you reach the app
at `https://taskmaster.<your-domain>` with automatic TLS:

```
taskmaster.<your-domain> {
    reverse_proxy 127.0.0.1:8080
}
```

With `NODE_ENV=production` the refresh cookie is marked `Secure` – over HTTPS the login
works as intended.

### Backup

The data lives in the SQLite file inside the Docker volume `taskmaster_data`. Backup:

```bash
docker run --rm \
  -v taskmaster_data:/app/data \
  -v "$(pwd):/backup" \
  alpine tar czf /backup/taskmaster-backup-$(date +%F).tgz -C /app/data .
```

## Configuration

Everything is configured through **environment variables**. The commented template lives
in [`.env.example`](.env.example) at the repo root – `cp .env.example .env` and adjust.
Under CasaOS, set the same variables in the container's app settings.

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | `change-me-in-production` | Token signing secret. **Required in production** (min. 16 chars). Generate: `openssl rand -hex 32` |
| `JWT_ACCESS_TTL` | `15m` | Access-token lifetime (ms format, e.g. `15m`, `1h`) |
| `JWT_REFRESH_TTL` | `7d` | Refresh-token lifetime (e.g. `7d`, `30d`) |
| `ADMIN_EMAIL` | `admin@taskmaster.local` | Email of the initial admin account (first start only) |
| `ADMIN_PASSWORD` | `admin123` | Password of the initial admin account – **change it!** |
| `PORT` | `8080` | HTTP port (inside the container) |
| `HOST` | `0.0.0.0` | Bind address (container-internal) |
| `DB_PATH` | `./data/taskmaster.db` | Path to the SQLite file; in the container: `/app/data/taskmaster.db` |
| `NODE_ENV` | `development` | `development` / `production` / `test` – controls logging, CORS and cookie flags |

Notes:

- **`JWT_SECRET`** is the most important variable. A known secret allows forging tokens.
  Generate one with `openssl rand -hex 32` and put it into `.env`.
- **`docker-compose.yml`** is fully commented (ports, volume, healthcheck, restart
  policy) and supports both modes: image pull and local build.
- **`server/src/config.ts`** validates the variables on startup (zod): invalid values
  terminate the process with a clear message instead of obscure runtime errors.

## API overview

All endpoints except `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh` and
`/api/health` require `Authorization: Bearer <access-token>`.
Error responses are uniform: `{ "error": { "code", "message" } }`.

| Method | Route | Description | Access |
|---|---|---|---|
| POST | `/api/auth/register` | Register | public |
| POST | `/api/auth/login` | Login → access token + refresh cookie | public |
| POST | `/api/auth/refresh` | Renew access token (cookie) | public |
| POST | `/api/auth/logout` | Clear refresh cookie | authenticated |
| GET | `/api/auth/me` | Current user | authenticated |
| GET | `/api/health` | Liveness check | public |
| GET | `/api/tasks` | Task list (filters, pagination, search) | authenticated |
| GET | `/api/tasks/overdue` | Overdue tasks | authenticated |
| POST | `/api/tasks` | Create task | authenticated |
| GET | `/api/tasks/:id` | Single task | visible |
| PUT | `/api/tasks/:id` | Update task | visible |
| DELETE | `/api/tasks/:id` | Delete task | visible |
| POST | `/api/tasks/:id/complete` | Complete (body: `nextDueAt?`, `comment?`) | visible |
| POST | `/api/tasks/:id/reopen` | Reopen (one-off only) | visible |
| GET | `/api/tasks/:id/events` | History (completed/reopened/comments) | visible |
| POST | `/api/tasks/:id/comment` | Add a comment | visible |
| GET | `/api/calendar?from=&to=` | Calendar entries incl. recurrence occurrences | authenticated |
| GET | `/api/categories` | Categories | authenticated |
| POST | `/api/categories` | Create category (body: `{ name, color? }`) | authenticated |
| PUT | `/api/categories/:id` | Update category | authenticated |
| DELETE | `/api/categories/:id` | Delete category | authenticated |
| GET | `/api/users` | All users | Admin |
| GET | `/api/users/picker` | User list for assignment | authenticated |
| GET | `/api/users/:id` | Single user | Admin |
| PUT | `/api/users/:id` | Update user (role, password …) | Admin |
| DELETE | `/api/users/:id` | Delete user | Admin |

## Project structure

```
TaskMaster/
├── .env.example           # Commented environment-variable template
├── .github/workflows/     # CI (build+test) and Publish (GHCR multi-arch)
├── Dockerfile             # Multi-stage: web-build → server-build → runtime
├── docker-compose.yml     # Commented compose for homelab/CasaOS
├── CONTRIBUTING.md
├── LICENSE                # GPL-3.0
├── server/                # Fastify + TypeScript backend
│   ├── src/
│   │   ├── config.ts      # Env configuration (zod, commented)
│   │   ├── db/            # Schema, migrations, client, seed
│   │   ├── modules/       # Auth, Tasks, Categories, Users, Calendar
│   │   └── middleware/    # JWT guards, visibility filter, error handler
│   └── test/              # Vitest (32 tests, in-memory DB)
└── web/                   # React 19 + Vite + MUI PWA
    └── src/
        ├── api/           # Axios clients (401-refresh interceptor)
        ├── components/    # Layout, tasks, auth …
        ├── context/       # Auth, theme, notify
        ├── hooks/         # incl. useOverdueCount (60 s polling)
        └── pages/         # Dashboard, Calendar, Matrix, Categories, Overdue, Admin
```

## Contributing

Contributions are welcome! A short guide (fork, branches, quality checks, conventional
commits) is in [CONTRIBUTING.md](CONTRIBUTING.md). For bugs and feature requests,
please use the GitHub issue tracker.

## AI assistance note

This project was developed with support from **opencode** and the language model
**DeepSeek v4** (flavors **Flash** and **Pro**).

## License

[GPL-3.0](LICENSE) © 2026 Moritz (gregorsp).
