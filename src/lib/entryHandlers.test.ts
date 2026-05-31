import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '@/test/testDb';
import { sanitizeSingleLine, sanitizeMarkdownText } from '@/lib/validation';
import type { EntryWithRelations } from '@/types';
import {
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
} from './entryHandlers';

/**
 * Unit + property-based tests for the Entry API core handlers (Task 8).
 *
 * Handlers are invoked directly with constructed Web `Request` objects and the
 * isolated test-DB harness (real migrated SQLite incl. FTS5 triggers), so no
 * live Next.js server is needed. Covers list/get/create/update/delete, nested
 * definitions/examples, duplicate detection (409), and cascade deletes.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 3.4, 13.2, 14.2.
 * Properties: Property 6 (duplicate prevention), Property 7 (cascade integrity).
 */

const BASE = 'http://localhost/api/entries';

function postReq(body: unknown): Request {
  return new Request(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown): Request {
  return new Request(`${BASE}/1`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function listReq(categoryId?: number | string): Request {
  const url =
    categoryId === undefined ? BASE : `${BASE}?categoryId=${categoryId}`;
  return new Request(url);
}

async function body<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Example-based unit tests
// ---------------------------------------------------------------------------

describe('Entry API handlers', () => {
  let db: TestDb;
  let prisma: PrismaClient;
  let categoryId: number;
  let otherCategoryId: number;

  beforeAll(async () => {
    db = createTestDb();
    prisma = db.prisma;
    const cat = await prisma.category.create({ data: { name: 'Vocabulary' } });
    const other = await prisma.category.create({ data: { name: 'Accretion' } });
    categoryId = cat.id;
    otherCategoryId = other.id;
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  it('creates an entry with nested definitions and examples (201)', async () => {
    const res = await createEntry(
      postReq({
        word: 'provoke',
        pronunciation: '/prəˈvəʊk/',
        categoryId,
        definitions: [
          { text: '激起，激发 to **stimulate** a reaction', partOfSpeech: 'V' },
          { text: 'to annoy 惹怒' },
        ],
        examples: [{ text: 'The remark *provoked* laughter. 引起了笑声。' }],
      }),
      prisma,
    );

    expect(res.status).toBe(201);
    const entry = await body<EntryWithRelations>(res);
    expect(entry.word).toBe('provoke');
    expect(entry.category.id).toBe(categoryId);
    expect(entry.definitions).toHaveLength(2);
    // displayOrder is assigned by array position.
    expect(entry.definitions[0].displayOrder).toBe(0);
    expect(entry.definitions[1].displayOrder).toBe(1);
    expect(entry.definitions[0].partOfSpeech).toBe('V');
    expect(entry.examples).toHaveLength(1);
    expect(entry.examples[0].text).toContain('引起了笑声');
  });

  it('rejects an invalid payload with field errors (400)', async () => {
    const res = await createEntry(
      postReq({ word: '   ', categoryId, definitions: [] }),
      prisma,
    );
    expect(res.status).toBe(400);
    const err = await body<{ error: string; fieldErrors: { field: string }[] }>(res);
    const fields = err.fieldErrors.map((f) => f.field);
    expect(fields).toContain('word');
    expect(fields).toContain('definitions');
  });

  it('rejects creation against a non-existent category (400)', async () => {
    const res = await createEntry(
      postReq({ word: 'ghost', categoryId: 999999, definitions: [{ text: 'x' }] }),
      prisma,
    );
    expect(res.status).toBe(400);
    const err = await body<{ fieldErrors: { field: string }[] }>(res);
    expect(err.fieldErrors.some((f) => f.field === 'categoryId')).toBe(true);
  });

  it('returns 409 when creating a duplicate (word, categoryId)', async () => {
    await createEntry(
      postReq({ word: 'duplicate', categoryId, definitions: [{ text: 'first' }] }),
      prisma,
    );
    const res = await createEntry(
      postReq({ word: 'duplicate', categoryId, definitions: [{ text: 'second' }] }),
      prisma,
    );
    expect(res.status).toBe(409);
    const count = await prisma.entry.count({
      where: { word: 'duplicate', categoryId },
    });
    expect(count).toBe(1);
  });

  it('allows the same word in a different category', async () => {
    await createEntry(
      postReq({ word: 'sharedword', categoryId, definitions: [{ text: 'a' }] }),
      prisma,
    );
    const res = await createEntry(
      postReq({
        word: 'sharedword',
        categoryId: otherCategoryId,
        definitions: [{ text: 'b' }],
      }),
      prisma,
    );
    expect(res.status).toBe(201);
  });

  it('lists entries filtered by categoryId', async () => {
    const res = await listEntries(listReq(otherCategoryId), prisma);
    expect(res.status).toBe(200);
    const entries = await body<EntryWithRelations[]>(res);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.categoryId === otherCategoryId)).toBe(true);
  });

  it('rejects a non-numeric categoryId filter (400)', async () => {
    const res = await listEntries(listReq('abc'), prisma);
    expect(res.status).toBe(400);
  });

  it('gets a single populated entry and 404s for unknown ids', async () => {
    const created = await body<EntryWithRelations>(
      await createEntry(
        postReq({ word: 'lookup', categoryId, definitions: [{ text: 'def' }] }),
        prisma,
      ),
    );

    const ok = await getEntry(prisma, created.id);
    expect(ok.status).toBe(200);
    const fetched = await body<EntryWithRelations>(ok);
    expect(fetched.id).toBe(created.id);
    expect(fetched.definitions).toHaveLength(1);

    const missing = await getEntry(prisma, 999999);
    expect(missing.status).toBe(404);
  });

  it('updates scalar fields in place', async () => {
    const created = await body<EntryWithRelations>(
      await createEntry(
        postReq({ word: 'editme', categoryId, definitions: [{ text: 'def' }] }),
        prisma,
      ),
    );

    const res = await updateEntry(
      patchReq({ pronunciation: '/edit/', notes: 'a **note**' }),
      prisma,
      created.id,
    );
    expect(res.status).toBe(200);
    const updated = await body<EntryWithRelations>(res);
    expect(updated.pronunciation).toBe('/edit/');
    expect(updated.notes).toBe('a **note**');
    // Definitions untouched when not supplied.
    expect(updated.definitions).toHaveLength(1);
  });

  it('replaces the definition set when definitions are supplied', async () => {
    const created = await body<EntryWithRelations>(
      await createEntry(
        postReq({
          word: 'replacer',
          categoryId,
          definitions: [{ text: 'old-1' }, { text: 'old-2' }],
        }),
        prisma,
      ),
    );

    const res = await updateEntry(
      patchReq({ definitions: [{ text: 'replacementdefinition' }] }),
      prisma,
      created.id,
    );
    expect(res.status).toBe(200);
    const updated = await body<EntryWithRelations>(res);
    expect(updated.definitions).toHaveLength(1);
    expect(updated.definitions[0].text).toBe('replacementdefinition');

    // No orphaned definitions left behind.
    const total = await prisma.definition.count({ where: { entryId: created.id } });
    expect(total).toBe(1);

    // FTS reflects the new definition, not the old (triggers recomputed it).
    const ftsNew = await prisma.$queryRawUnsafe<{ rowid: number }[]>(
      'SELECT rowid FROM "EntryFts" WHERE "EntryFts" MATCH ?',
      'replacementdefinition',
    );
    expect(ftsNew.map((r) => Number(r.rowid))).toContain(created.id);
  });

  it('clears examples when an empty examples array is supplied', async () => {
    const created = await body<EntryWithRelations>(
      await createEntry(
        postReq({
          word: 'clearex',
          categoryId,
          definitions: [{ text: 'd' }],
          examples: [{ text: 'ex-1' }, { text: 'ex-2' }],
        }),
        prisma,
      ),
    );

    const res = await updateEntry(patchReq({ examples: [] }), prisma, created.id);
    expect(res.status).toBe(200);
    const updated = await body<EntryWithRelations>(res);
    expect(updated.examples).toHaveLength(0);
  });

  it('returns 409 when a rename collides with an existing entry', async () => {
    await createEntry(
      postReq({ word: 'target', categoryId, definitions: [{ text: 'd' }] }),
      prisma,
    );
    const mover = await body<EntryWithRelations>(
      await createEntry(
        postReq({ word: 'mover', categoryId, definitions: [{ text: 'd' }] }),
        prisma,
      ),
    );

    const res = await updateEntry(
      patchReq({ word: 'target' }),
      prisma,
      mover.id,
    );
    expect(res.status).toBe(409);
  });

  it('allows a no-op rename to the same word (ignores self)', async () => {
    const created = await body<EntryWithRelations>(
      await createEntry(
        postReq({ word: 'selfsame', categoryId, definitions: [{ text: 'd' }] }),
        prisma,
      ),
    );
    const res = await updateEntry(
      patchReq({ word: 'selfsame', pronunciation: '/s/' }),
      prisma,
      created.id,
    );
    expect(res.status).toBe(200);
  });

  it('404s when updating or deleting an unknown entry', async () => {
    const upd = await updateEntry(patchReq({ word: 'x' }), prisma, 999999);
    expect(upd.status).toBe(404);
    const del = await deleteEntry(prisma, 999999);
    expect(del.status).toBe(404);
  });

  it('deletes an entry and cascades its children', async () => {
    const created = await body<EntryWithRelations>(
      await createEntry(
        postReq({
          word: 'cascade-word',
          categoryId,
          definitions: [{ text: 'd1' }, { text: 'd2' }],
          examples: [{ text: 'e1' }],
        }),
        prisma,
      ),
    );
    await prisma.image.create({
      data: {
        entryId: created.id,
        filename: 'c.jpg',
        thumbnailFilename: 'c.thumb.jpg',
        fileSize: 1,
      },
    });

    const res = await deleteEntry(prisma, created.id);
    expect(res.status).toBe(200);

    expect(await prisma.entry.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await prisma.definition.count({ where: { entryId: created.id } })).toBe(0);
    expect(await prisma.example.count({ where: { entryId: created.id } })).toBe(0);
    expect(await prisma.image.count({ where: { entryId: created.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

/** Words that survive single-line sanitization as non-empty. */
const wordArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => sanitizeSingleLine(s).length > 0);

/** Non-empty Markdown text for definitions/examples. */
const textArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => sanitizeMarkdownText(s).length > 0);

const definitionsArb = fc.array(
  fc.record({ text: textArb }),
  { minLength: 1, maxLength: 4 },
);

const examplesArb = fc.array(fc.record({ text: textArb }), {
  minLength: 0,
  maxLength: 3,
});

describe('Property 6: duplicate prevention', () => {
  // **Validates: Requirements 2.1, 2.2**
  let db: TestDb;
  let prisma: PrismaClient;

  beforeAll(() => {
    db = createTestDb();
    prisma = db.prisma;
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  it('never allows two entries with the same (word, categoryId)', async () => {
    await fc.assert(
      fc.asyncProperty(wordArb, definitionsArb, async (word, definitions) => {
        // Fresh category per run isolates the (word, categoryId) space so
        // generated words cannot collide across runs.
        const cat = await prisma.category.create({ data: { name: 'P6' } });

        const first = await createEntry(
          postReq({ word, categoryId: cat.id, definitions }),
          prisma,
        );
        expect(first.status).toBe(201);

        const second = await createEntry(
          postReq({ word, categoryId: cat.id, definitions }),
          prisma,
        );
        expect(second.status).toBe(409);

        const stored = sanitizeSingleLine(word);
        const count = await prisma.entry.count({
          where: { word: stored, categoryId: cat.id },
        });
        expect(count).toBe(1);

        // The same word in a different category is permitted (constraint is
        // scoped to the category).
        const otherCat = await prisma.category.create({ data: { name: 'P6b' } });
        const third = await createEntry(
          postReq({ word, categoryId: otherCat.id, definitions }),
          prisma,
        );
        expect(third.status).toBe(201);
      }),
      { numRuns: 25 },
    );
  }, 60_000);
});

describe('Property 7: cascade integrity', () => {
  // **Validates: Requirements 2.3, 4.4**
  let db: TestDb;
  let prisma: PrismaClient;

  beforeAll(() => {
    db = createTestDb();
    prisma = db.prisma;
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  it('leaves no orphaned definitions/examples/images after deleting an entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        wordArb,
        definitionsArb,
        examplesArb,
        fc.integer({ min: 0, max: 3 }),
        async (word, definitions, examples, imageCount) => {
          const cat = await prisma.category.create({ data: { name: 'P7' } });

          const created = await body<EntryWithRelations>(
            await createEntry(
              postReq({ word, categoryId: cat.id, definitions, examples }),
              prisma,
            ),
          );
          const id = created.id;

          // Attach images directly (image upload is a separate task); their
          // cascade-on-delete is what we are validating here.
          for (let i = 0; i < imageCount; i += 1) {
            await prisma.image.create({
              data: {
                entryId: id,
                filename: `f${i}.jpg`,
                thumbnailFilename: `f${i}.thumb.jpg`,
                fileSize: 1,
              },
            });
          }

          const del = await deleteEntry(prisma, id);
          expect(del.status).toBe(200);

          // Entry and every child row are gone.
          expect(await prisma.entry.findUnique({ where: { id } })).toBeNull();
          expect(await prisma.definition.count({ where: { entryId: id } })).toBe(0);
          expect(await prisma.example.count({ where: { entryId: id } })).toBe(0);
          expect(await prisma.image.count({ where: { entryId: id } })).toBe(0);

          // FTS row removed by the delete trigger.
          const fts = await prisma.$queryRawUnsafe<{ rowid: number }[]>(
            'SELECT rowid FROM "EntryFts" WHERE rowid = ?',
            id,
          );
          expect(fts).toHaveLength(0);
        },
      ),
      { numRuns: 25 },
    );
  }, 60_000);
});
