# Tech Stack

## Core

- **Framework:** Next.js 14 (App Router) with `output: 'standalone'`.
  `reactStrictMode` on.
- **Language:** TypeScript 5.6 in `strict` mode. Path alias `@/*` → `./src/*`.
- **UI:** React 18, Tailwind CSS 3, `next-themes` for light/dark mode.
- **Data:** Prisma 5.22 + SQLite. The DB file lives in `data/lexical.db`
  (`DATABASE_URL=file:../data/lexical.db`, relative to `prisma/`).
- **Search:** SQLite FTS5 virtual table (`EntryFts`) + sync triggers, added via
  raw-SQL inside the Prisma migration (Prisma can't model FTS5 natively).
- **Markdown:** `react-markdown` + `rehype-sanitize` (always sanitize rendered
  Markdown).
- **Images:** `sharp` for thumbnails; `node-html-parser` for legacy HTML import.
- **Lists:** `@tanstack/react-virtual` for virtualized long lists.
- **Client data fetching:** `swr`.

## Testing

- **Unit / integration / property:** Vitest (jsdom env, globals on).
  `fast-check` for property-based tests. Tests are colocated as
  `*.test.ts(x)` under `src/**` and `scripts/**`.
- **E2E:** Playwright, specs in `tests/e2e/` (excluded from Vitest, ESLint, and
  tsconfig). E2E uses a hermetic, freshly-migrated+seeded temp SQLite DB via
  `globalSetup`/`globalTeardown`; never touches `data/lexical.db`.

## Common commands

```bash
npm install
cp .env.example .env               # DATABASE_URL -> data/lexical.db
npm run prisma:migrate:deploy      # apply migrations (creates the DB)
npm run dev                        # dev server at http://localhost:3000

npm run build                      # production build (.next/standalone)
npm start                          # run the production build

npm test                           # Vitest (unit + property)
npm run test:watch                 # Vitest watch
npm run test:e2e                   # Playwright E2E
npm run lint                       # next lint

npm run prisma:generate            # regenerate Prisma client
npm run prisma:migrate:deploy      # apply migrations (use this, see below)
```

> Do NOT run long-running commands (`npm run dev`, `test:watch`) inline; the
> user runs those in their own terminal.

## Critical conventions

- **Migrations: always `prisma migrate deploy`, never `prisma migrate dev`.**
  The FTS5 virtual table + triggers are raw SQL; `migrate dev` drift detection
  would offer to drop them. See `prisma/README.md`.
- **Prisma client is a singleton** (`src/lib/db.ts`) cached on `globalThis` in
  non-production to survive HMR. Import `prisma` from `@/lib/db`; don't
  instantiate `PrismaClient` elsewhere.
- **API route handlers** return Web-standard `Response` objects (no
  `next/server` dependency) so they're unit-testable with plain `Request`s. Use
  the helpers in `src/lib/apiResponse.ts` (`jsonResponse`, `errorResponse`,
  `validationErrorResponse`, `notFoundResponse`).
- **Keep business logic in `src/lib/`**, not in route handlers, so it can be
  unit/property-tested against an isolated DB without HTTP.
- Search must never throw out of `src/lib/search.ts`; FTS failures fall back to
  LIKE. Preserve search soundness (results actually contain the query) and
  completeness (all word-substring matches returned).
- Docker: multi-stage image runs as non-root, applies migrations on startup
  (`docker-entrypoint.sh`), and exposes `GET /api/health`.
