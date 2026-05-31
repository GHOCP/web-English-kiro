// Route handlers for `/api/entries`.
//
// Thin bindings over the testable core handlers in `@/lib/entryHandlers`,
// wired to the shared Prisma singleton. The actual logic (validation,
// duplicate detection, nested writes, transactions) lives in the lib module so
// it can be unit-tested with the test-DB harness and constructed `Request`s.
//
// Requirements: 2.1, 2.2, 3.2, 13.2, 14.2.
import { prisma } from '@/lib/db';
import { listEntries, createEntry } from '@/lib/entryHandlers';

/** GET /api/entries?categoryId= — list entries (optionally by category). */
export function GET(request: Request): Promise<Response> {
  return listEntries(request, prisma);
}

/** POST /api/entries — create an entry with nested definitions/examples. */
export function POST(request: Request): Promise<Response> {
  return createEntry(request, prisma);
}
