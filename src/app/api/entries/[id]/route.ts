// Route handlers for `/api/entries/:id`.
//
// Thin bindings over the testable core handlers in `@/lib/entryHandlers`,
// wired to the shared Prisma singleton. See that module for the CRUD logic.
//
// Requirements: 2.2, 2.3, 2.4, 3.2.
import { prisma } from '@/lib/db';
import { getEntry, updateEntry, deleteEntry } from '@/lib/entryHandlers';

/** Route context carrying the dynamic `:id` segment. */
interface RouteContext {
  params: { id: string };
}

/** GET /api/entries/:id — fetch a single fully-populated entry. */
export function GET(_request: Request, context: RouteContext): Promise<Response> {
  return getEntry(prisma, context.params.id);
}

/** PATCH /api/entries/:id — update scalars and/or replace definitions/examples. */
export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return updateEntry(request, prisma, context.params.id);
}

/** DELETE /api/entries/:id — delete the entry (children cascade). */
export function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return deleteEntry(prisma, context.params.id);
}
