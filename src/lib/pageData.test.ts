import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '@/test/testDb';
import { getCategoryPageData, getEntryPageData } from '@/lib/pageData';

/**
 * Page-data loader tests (Task 19).
 *
 * Exercises the SSR data layer that backs the `/category/:id` and `/entry/:id`
 * pages against an isolated, fully-migrated SQLite database (no HTTP server).
 * Covers:
 *   - viewType is surfaced so the page can pick the right view component;
 *   - a thesaurus subtree's entries are grouped by category id (the shape
 *     ThesaurusView consumes), including nested sub-categories;
 *   - a missing category / entry resolves to null (→ notFound() in the page);
 *   - the seeded category data-fetch comfortably meets the < 500ms localhost
 *     page-load budget (R11.1).
 *
 * Requirements: 11.1, 11.4, 5.4, 6.3
 */

let db: TestDb;
let prisma: PrismaClient;

beforeAll(() => {
  db = createTestDb();
  prisma = db.prisma;
}, 60_000);

afterAll(async () => {
  await db.cleanup();
});

afterEach(async () => {
  await prisma.entry.deleteMany();
  await prisma.category.deleteMany();
});

describe('getCategoryPageData', () => {
  it('returns null for a category that does not exist', async () => {
    expect(await getCategoryPageData(prisma, 99999)).toBeNull();
  });

  it('surfaces the viewType and the category own ordered entries (list)', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Genres', viewType: 'genre' },
    });
    await prisma.entry.create({
      data: { word: 'banana', categoryId: cat.id, displayOrder: 1 },
    });
    await prisma.entry.create({
      data: { word: 'apple', categoryId: cat.id, displayOrder: 0 },
    });

    const data = await getCategoryPageData(prisma, cat.id);
    expect(data).not.toBeNull();
    expect(data!.viewType).toBe('genre');
    expect(data!.category.id).toBe(cat.id);
    // Ordered by displayOrder then word.
    expect(data!.entries.map((e) => e.word)).toEqual(['apple', 'banana']);
  });

  it('groups a thesaurus subtree entries by category id (incl. nested)', async () => {
    const root = await prisma.category.create({
      data: { name: 'Verbs', viewType: 'thesaurus', partOfSpeech: 'V' },
    });
    const groupA = await prisma.category.create({
      data: { name: '刺激。激发', viewType: 'thesaurus', parentId: root.id },
    });
    const groupB = await prisma.category.create({
      data: { name: '压制，压迫', viewType: 'thesaurus', parentId: root.id },
    });

    await prisma.entry.create({ data: { word: 'provoke', categoryId: groupA.id } });
    await prisma.entry.create({ data: { word: 'incite', categoryId: groupA.id } });
    await prisma.entry.create({ data: { word: 'suppress', categoryId: groupB.id } });

    const data = await getCategoryPageData(prisma, root.id);
    expect(data).not.toBeNull();
    // The returned node carries its nested subtree.
    expect(data!.category.children.map((c) => c.id).sort()).toEqual(
      [groupA.id, groupB.id].sort(),
    );
    // Entries are grouped by their owning category id across the whole subtree.
    expect(data!.entriesByCategory[groupA.id].map((e) => e.word).sort()).toEqual(
      ['incite', 'provoke'],
    );
    expect(data!.entriesByCategory[groupB.id].map((e) => e.word)).toEqual([
      'suppress',
    ]);
    // The root itself owns no entries here.
    expect(data!.entries).toEqual([]);
  });

  it('includes fully-populated relations on each entry', async () => {
    const cat = await prisma.category.create({ data: { name: 'List' } });
    await prisma.entry.create({
      data: {
        word: 'provoke',
        categoryId: cat.id,
        definitions: { create: [{ text: 'to annoy 激怒', displayOrder: 0 }] },
        examples: { create: [{ text: 'They provoked him.', displayOrder: 0 }] },
      },
    });

    const data = await getCategoryPageData(prisma, cat.id);
    const entry = data!.entries[0];
    expect(entry.definitions[0].text).toBe('to annoy 激怒');
    expect(entry.examples[0].text).toBe('They provoked him.');
    expect(entry.category.name).toBe('List');
  });

  it('meets the < 500ms localhost page-load budget for a seeded category', async () => {
    const cat = await prisma.category.create({ data: { name: 'Big' } });
    // Seed a realistically sized category in one transaction.
    await prisma.$transaction(
      Array.from({ length: 200 }, (_, i) =>
        prisma.entry.create({
          data: {
            word: `word-${i}`,
            categoryId: cat.id,
            displayOrder: i,
            definitions: { create: [{ text: `meaning ${i}`, displayOrder: 0 }] },
          },
        }),
      ),
    );

    const start = performance.now();
    const data = await getCategoryPageData(prisma, cat.id);
    const elapsed = performance.now() - start;

    expect(data!.entries).toHaveLength(200);
    // eslint-disable-next-line no-console
    console.log(`[timing] getCategoryPageData(200 entries) = ${elapsed.toFixed(1)}ms`);
    // R11.1: any page within 500ms on localhost. The data fetch is the
    // dominant server cost; it should complete well under budget.
    expect(elapsed).toBeLessThan(500);
  });
});

describe('getEntryPageData', () => {
  it('returns a fully-populated entry', async () => {
    const cat = await prisma.category.create({ data: { name: 'List' } });
    const created = await prisma.entry.create({
      data: {
        word: 'provoke',
        pronunciation: '/prəˈvəʊk/',
        categoryId: cat.id,
        definitions: { create: [{ text: 'to annoy', displayOrder: 0 }] },
      },
    });

    const entry = await getEntryPageData(prisma, created.id);
    expect(entry).not.toBeNull();
    expect(entry!.word).toBe('provoke');
    expect(entry!.definitions).toHaveLength(1);
    expect(entry!.category.name).toBe('List');
  });

  it('returns null for a missing entry', async () => {
    expect(await getEntryPageData(prisma, 99999)).toBeNull();
  });
});
