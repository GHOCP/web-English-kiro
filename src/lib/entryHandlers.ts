// Entry API core handlers (Task 8).
//
// These functions implement the CRUD logic for `/api/entries` and
// `/api/entries/:id`. They are written against the Web-standard `Request`/
// `Response` types and take an injected `PrismaClient`, so they can be unit-
// tested directly with a constructed `Request` and the test-DB harness — no
// live Next.js server required. The thin route files in `src/app/api/entries`
// simply bind these to the Prisma singleton.
//
// Behavior summary:
//   - GET (list)   : entries for `?categoryId=` (or all), ordered for display.
//   - GET (one)    : a single fully-populated entry, 404 when missing.
//   - POST         : validate → verify category → duplicate check (409) →
//                    create entry with nested definitions/examples in a
//                    transaction → attach any `imageIds`.
//   - PATCH        : validate → 404 when missing → duplicate check on
//                    word/category change (ignoring self) → update scalars and,
//                    when supplied, REPLACE the definition/example sets inside a
//                    transaction so the FTS5 triggers stay consistent.
//   - DELETE       : delete the entry; definitions/examples/images cascade and
//                    the FTS row is removed by its trigger.
//
// Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 3.4, 13.2, 14.2.
// Properties: Property 6 (duplicate prevention), Property 7 (cascade integrity).
import { Prisma, type PrismaClient } from '@prisma/client';
import type { EntryWithRelations } from '@/types';
import {
  validateCreateEntry,
  validateUpdateEntry,
  checkDuplicateEntry,
  duplicateEntryError,
} from '@/lib/validation';
import {
  jsonResponse,
  errorResponse,
  validationErrorResponse,
  notFoundResponse,
} from '@/lib/apiResponse';

/**
 * A Prisma client or transaction client. The handlers only use model methods
 * plus `$transaction`, so either works; we type the parameter loosely as
 * `PrismaClient` and pass the transaction client where a transaction is open.
 */
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

/** Relation include used everywhere a full entry is returned. */
const entryInclude = {
  definitions: { orderBy: { displayOrder: 'asc' } },
  examples: { orderBy: { displayOrder: 'asc' } },
  images: { orderBy: { id: 'asc' } },
  category: true,
} satisfies Prisma.EntryInclude;

// ---------------------------------------------------------------------------
// Small request-parsing helpers
// ---------------------------------------------------------------------------

/** Parse a route `:id` segment into a positive integer, or `null` if invalid. */
function parseId(raw: string | number): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** Result of attempting to read a JSON request body. */
type JsonParse = { ok: true; value: unknown } | { ok: false; response: Response };

/** Read and JSON-parse a request body, returning a 400 response on failure. */
async function readJsonBody(request: Request): Promise<JsonParse> {
  try {
    const value = await request.json();
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      response: errorResponse({ error: 'Request body must be valid JSON.' }, 400),
    };
  }
}

/** Load a fully-populated entry (ordered relations) or `null` when missing. */
async function loadEntry(
  db: Db,
  id: number,
): Promise<EntryWithRelations | null> {
  return db.entry.findUnique({
    where: { id },
    include: entryInclude,
  }) as Promise<EntryWithRelations | null>;
}

// ---------------------------------------------------------------------------
// GET /api/entries  (list, optionally filtered by categoryId)
// ---------------------------------------------------------------------------

/**
 * List entries. With `?categoryId=<int>` only that category's entries are
 * returned; without it, all entries are returned. Results are ordered by
 * `displayOrder` then `word` for a stable, readable listing.
 */
export async function listEntries(request: Request, db: Db): Promise<Response> {
  const url = new URL(request.url);
  const raw = url.searchParams.get('categoryId');

  let where: Prisma.EntryWhereInput | undefined;
  if (raw !== null && raw !== '') {
    const categoryId = parseId(raw);
    if (categoryId === null) {
      return validationErrorResponse([
        { field: 'categoryId', message: 'categoryId must be a positive integer.' },
      ]);
    }
    where = { categoryId };
  }

  const entries = await db.entry.findMany({
    where,
    include: entryInclude,
    orderBy: [{ displayOrder: 'asc' }, { word: 'asc' }],
  });

  return jsonResponse(entries);
}

// ---------------------------------------------------------------------------
// GET /api/entries/:id  (single entry)
// ---------------------------------------------------------------------------

/** Fetch a single fully-populated entry. 404 when it does not exist. */
export async function getEntry(db: Db, idParam: string | number): Promise<Response> {
  const id = parseId(idParam);
  if (id === null) {
    return validationErrorResponse([
      { field: 'id', message: 'Entry id must be a positive integer.' },
    ]);
  }

  const entry = await loadEntry(db, id);
  if (!entry) return notFoundResponse('Entry not found.');
  return jsonResponse(entry);
}

// ---------------------------------------------------------------------------
// POST /api/entries  (create)
// ---------------------------------------------------------------------------

/**
 * Create an entry with nested definitions/examples and optional image
 * attachment, all inside a transaction (NFR 3.2). Returns 409 when an entry
 * with the same (word, categoryId) already exists (Property 6), 400 for
 * invalid input or unknown category.
 */
export async function createEntry(request: Request, db: Db): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const result = validateCreateEntry(body.value);
  if (!result.success) return validationErrorResponse(result.errors);
  const data = result.data;

  // Referential check: the target category must exist.
  const category = await db.category.findUnique({ where: { id: data.categoryId } });
  if (!category) {
    return validationErrorResponse([
      { field: 'categoryId', message: 'Category does not exist.' },
    ]);
  }

  // Duplicate prevention (Property 6 / NFR 3.3) — explicit pre-check for a
  // clean 409; the DB unique constraint is the ultimate guard (caught below).
  const existing = await db.entry.findUnique({
    where: { word_categoryId: { word: data.word, categoryId: data.categoryId } },
    select: { id: true },
  });
  const dup = checkDuplicateEntry(existing);
  if (dup) return errorResponse(dup, 409);

  let newId: number;
  try {
    newId = await db.$transaction(async (tx: Tx) => {
      const entry = await tx.entry.create({
        data: {
          word: data.word,
          pronunciation: data.pronunciation ?? null,
          categoryId: data.categoryId,
          ...(data.entryType ? { entryType: data.entryType } : {}),
          notes: data.notes ?? null,
          definitions: {
            create: data.definitions.map((d, index) => ({
              text: d.text,
              partOfSpeech: d.partOfSpeech ?? null,
              displayOrder: index,
            })),
          },
          ...(data.examples
            ? {
                examples: {
                  create: data.examples.map((e, index) => ({
                    text: e.text,
                    displayOrder: index,
                  })),
                },
              }
            : {}),
        },
        select: { id: true },
      });

      if (data.imageIds && data.imageIds.length > 0) {
        await tx.image.updateMany({
          where: { id: { in: data.imageIds } },
          data: { entryId: entry.id },
        });
      }

      return entry.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errorResponse(duplicateEntryError(), 409);
    }
    throw err;
  }

  const full = await loadEntry(db, newId);
  return jsonResponse(full, 201);
}

// ---------------------------------------------------------------------------
// PATCH /api/entries/:id  (update)
// ---------------------------------------------------------------------------

/**
 * Update an entry. Scalar fields are patched in place; supplying `definitions`
 * or `examples` REPLACES the corresponding set (delete-all + recreate) inside a
 * transaction so the FTS5 definition triggers recompute correctly. When `word`
 * or `categoryId` changes, a duplicate check runs ignoring the entry itself.
 */
export async function updateEntry(
  request: Request,
  db: Db,
  idParam: string | number,
): Promise<Response> {
  const id = parseId(idParam);
  if (id === null) {
    return validationErrorResponse([
      { field: 'id', message: 'Entry id must be a positive integer.' },
    ]);
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const result = validateUpdateEntry(body.value);
  if (!result.success) return validationErrorResponse(result.errors);
  const data = result.data;

  const existing = await db.entry.findUnique({
    where: { id },
    select: { id: true, word: true, categoryId: true },
  });
  if (!existing) return notFoundResponse('Entry not found.');

  // Resolve the post-update identity to detect duplicates.
  const targetWord = data.word ?? existing.word;
  const targetCategoryId = data.categoryId ?? existing.categoryId;
  const identityChanged =
    (data.word !== undefined && data.word !== existing.word) ||
    (data.categoryId !== undefined && data.categoryId !== existing.categoryId);

  if (data.categoryId !== undefined && data.categoryId !== existing.categoryId) {
    const category = await db.category.findUnique({ where: { id: data.categoryId } });
    if (!category) {
      return validationErrorResponse([
        { field: 'categoryId', message: 'Category does not exist.' },
      ]);
    }
  }

  if (identityChanged) {
    const conflict = await db.entry.findUnique({
      where: {
        word_categoryId: { word: targetWord, categoryId: targetCategoryId },
      },
      select: { id: true },
    });
    const dup = checkDuplicateEntry(conflict, id);
    if (dup) return errorResponse(dup, 409);
  }

  // Build the scalar update payload from only the provided fields.
  const scalarData: Prisma.EntryUpdateInput = {};
  if (data.word !== undefined) scalarData.word = data.word;
  if (data.pronunciation !== undefined) scalarData.pronunciation = data.pronunciation;
  if (data.entryType !== undefined) scalarData.entryType = data.entryType;
  if (data.notes !== undefined) scalarData.notes = data.notes;
  if (data.displayOrder !== undefined) scalarData.displayOrder = data.displayOrder;
  if (data.categoryId !== undefined) {
    scalarData.category = { connect: { id: data.categoryId } };
  }

  try {
    await db.$transaction(async (tx: Tx) => {
      // Always touch the entry row so `updatedAt` advances and the FTS word
      // index refreshes; if no scalar fields changed this is a no-op update.
      await tx.entry.update({ where: { id }, data: scalarData });

      if (data.definitions !== undefined) {
        await tx.definition.deleteMany({ where: { entryId: id } });
        await tx.definition.createMany({
          data: data.definitions.map((d, index) => ({
            entryId: id,
            text: d.text,
            partOfSpeech: d.partOfSpeech ?? null,
            displayOrder: index,
          })),
        });
      }

      if (data.examples !== undefined) {
        await tx.example.deleteMany({ where: { entryId: id } });
        if (data.examples.length > 0) {
          await tx.example.createMany({
            data: data.examples.map((e, index) => ({
              entryId: id,
              text: e.text,
              displayOrder: index,
            })),
          });
        }
      }

      if (data.imageIds !== undefined && data.imageIds.length > 0) {
        await tx.image.updateMany({
          where: { id: { in: data.imageIds } },
          data: { entryId: id },
        });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errorResponse(duplicateEntryError(), 409);
    }
    throw err;
  }

  const full = await loadEntry(db, id);
  return jsonResponse(full);
}

// ---------------------------------------------------------------------------
// DELETE /api/entries/:id  (delete + cascade)
// ---------------------------------------------------------------------------

/**
 * Delete an entry. Its definitions, examples, and images cascade-delete (schema
 * `onDelete: Cascade`) and the FTS row is removed by the delete trigger,
 * leaving no orphaned children (Property 7). 404 when the entry is missing.
 */
export async function deleteEntry(db: Db, idParam: string | number): Promise<Response> {
  const id = parseId(idParam);
  if (id === null) {
    return validationErrorResponse([
      { field: 'id', message: 'Entry id must be a positive integer.' },
    ]);
  }

  const existing = await db.entry.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return notFoundResponse('Entry not found.');

  await db.entry.delete({ where: { id } });

  return jsonResponse({ deleted: true, id });
}
