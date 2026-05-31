# Project Structure

## Top-level layout

```
src/             Next.js application code (the only thing in the Docker image)
prisma/          schema.prisma + migrations (incl. raw-SQL FTS5)
scripts/         HTML -> JSON migration + JSON import tooling (+ tests)
tests/e2e/       Playwright E2E specs + hermetic DB setup/teardown
data/            SQLite database file (volume-mounted at runtime)
uploads/         Image originals + thumbnails (volume-mounted at runtime)
htmls/           Legacy static site — reference ONLY, excluded from build
.kiro/specs/     Source-of-truth requirements/design/tasks for the system
```

Root also holds the legacy static site (`index.html`, `main.js`, `styles.css`,
`images/`, `lead/`) — these are not part of the Next.js build.

## `src/` organization

```
src/app/          App Router: pages + API route handlers
  api/            Route handlers grouped by resource:
                  categories/, entries/, export/, health/, images/, search/
                  Dynamic segments use [id]/route.ts
  category/[id]/  Category page
  entry/[id]/     Entry page
  search/         Search page
  layout.tsx, page.tsx, globals.css
src/components/   React UI components (PascalCase.tsx) + colocated *.test.tsx
                  e.g. Sidebar, CategoryView, EntryEditor, EntryDetail,
                  ThesaurusView, GenreGridView, WritingView, SpeakingView,
                  Markdown, SearchBar/SearchResults, VirtualList, ThemeToggle
src/lib/          Business logic, DB access, helpers (+ colocated *.test.ts)
  db.ts           Prisma singleton
  apiResponse.ts  HTTP response helpers
  search.ts       FTS5 + LIKE search
  validation.ts   Input validation + error envelope
  categories.ts, entryHandlers.ts, images.ts, markdown.ts, pageData.ts, ...
  export/         JSON / CSV / Markdown exporters (index.ts barrel)
  migration/      Legacy HTML -> JSON parse/normalize/validate/import
src/types/        Shared types: models.ts (domain) + api.ts (contracts),
                  re-exported from index.ts barrel — import from `@/types`
src/test/         Test helpers (testDb.ts) + cross-cutting schema tests
```

## Conventions

- **Imports:** use the `@/` alias (`@/lib/db`, `@/types`) instead of long
  relative paths.
- **Tests are colocated** next to the code they cover as `*.test.ts(x)`.
  E2E specs live separately in `tests/e2e/`.
- **Components:** PascalCase filenames; one component per file with its test
  beside it.
- **lib modules:** camelCase filenames; keep DB/business logic here (testable
  without HTTP) and keep route handlers thin.
- **Types:** add domain models to `models.ts`, API request/response contracts to
  `api.ts`; both surface through the `@/types` barrel.
- **Barrels:** `export/` and `migration/` expose a public surface via
  `index.ts`; import from the barrel.
- The data model (Category → Entry → Definition/Example/Image, with cascade
  deletes) is defined in `prisma/schema.prisma`; keep it aligned with the spec
  in `.kiro/specs/lexical-resources-system/`.
