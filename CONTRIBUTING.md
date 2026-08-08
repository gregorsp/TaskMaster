# Contributing to TaskMaster

Thanks for taking the time to contribute! This is a family/homelab project,
but help is very welcome. Below is everything you need to get started.

## Getting started

1. Fork the repository and clone your fork.
2. Install dependencies and start the dev servers (see the README "Development" section).
3. Create a feature branch: `git checkout -b feat/your-feature`.

## Project layout

```
server/   Fastify + TypeScript backend (REST API, SQLite via sql.js + Drizzle ORM)
web/      React 19 + Vite + MUI PWA frontend
```

## Development workflow

- Run the backend: `cd server && npm run dev` (http://localhost:8080)
- Run the frontend: `cd web && npm run dev` (http://localhost:5173, proxies `/api` to 8080)
- The API docs, environment variables and config are documented in the README.

### When changing the database schema

If you modify `server/src/db/schema.ts`, follow this checklist:

1. Run `npm run db:generate` in `server/` — this creates a new migration file in `src/db/migrations/`.
2. Bump `SCHEMA_VERSION` in `server/src/db/version.ts` to match the new migration.
3. If the migration inserts data (e.g. a new `schema_version` row), add the `INSERT` / `UPDATE` by hand to the generated `.sql` file.
4. Write a migration test in `server/test/migration.test.ts` to verify the new migration applies correctly.
5. Update this checklist if the process changes.

**Important:** Never delete or modify an already-released migration file — always add new migrations. The Docker image ships the complete migration history so every update path works.

## Quality checks

Before submitting a pull request, make sure the checks pass:

```bash
# Backend
cd server
npm run build     # TypeScript compile
npm test          # Vitest test suite

# Frontend
cd web
npm run build     # tsc + vite build (includes PWA generation)
```

The CI pipeline (`ci.yml`) runs these same checks on every push/PR.

## Submitting changes

- Use [Conventional Commits](https://www.conventionalcommits.org/) style messages
  (e.g. `feat: ...`, `fix: ...`, `refactor: ...`).
- Keep changes focused: one logical change per pull request.
- Add or update tests where sensible.
- Open a pull request against `main` and describe what you changed and why.

## Reporting issues

Use the GitHub issue tracker. Please include:

- What you expected to happen and what actually happened
- Steps to reproduce
- Environment (Raspberry Pi model / OS, Docker version, browser) if relevant
- Relevant log output

## Code of conduct

Be respectful and constructive. This project is meant to be fun and useful —
for everyone in the household and beyond.
