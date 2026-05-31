// Shared ephemeral-database location for the E2E run (Task 20).
//
// Both the Playwright config (which passes DATABASE_URL to the dev server via
// `webServer.env`) and the global setup (which migrates + seeds that same file)
// must agree on exactly one database path. Computing it in this single module —
// imported by both — keeps the running app and the seed in lock-step.
//
// We use an ABSOLUTE `file:` URL so Prisma never resolves it relative to
// `prisma/schema.prisma` (the way the relative URL in `.env` is resolved). The
// file lives under `data/` so it is covered by the existing `.gitignore`
// (`/data/*.db`) and never committed, and is wiped + recreated each run so the
// suite is hermetic and deterministic.
import { join } from 'node:path';

/** Absolute path of the isolated E2E SQLite database file. */
export const E2E_DB_FILE = join(process.cwd(), 'data', 'e2e-test.db');

/** Prisma `file:` connection URL for {@link E2E_DB_FILE}. */
export const E2E_DB_URL = `file:${E2E_DB_FILE}`;
