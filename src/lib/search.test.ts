import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '@/test/testDb';
import {
  searchEntries,
  buildFtsMatchQuery,
  DEFAULT_SEARCH_LIMIT,
} from './search';

/**
 * Tests for the Search API logic (Task 10).
 *
 * Covers FTS5 + LIKE-fallback matching, snippet building, the empty-query
 * short-circuit, robustness against adversarial FTS input, the < 200ms / 10k
 * performance budget, and the two search correctness properties:
 *   - Property 4 (search soundness)
 *   - Property 5 (search completeness)
 *
 * All DB-backed tests use the migrated test-DB harness (real FTS5 + triggers).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 11.2
 */

/** Insert a category + entry (with optional definition texts). Returns id. */
async function seedEntry(
  prisma: PrismaClient,
  categoryId: number,
  word: string,
  definitions: string[] = [],
): Promise<number> {
  const entry = await prisma.entry.create({
    data: {
      word,
      categoryId,
      definitions: {
        create: definitions.map((text, i) => ({ text, displayOrder: i })),
      },
    },
  });
  return entry.id;
}

// ---------------------------------------------------------------------------
// buildFtsMatchQuery (pure, no DB)
// ---------------------------------------------------------------------------
describe('buildFtsMatchQuery', () => {
  it('wraps each token as a quoted prefix term', () => {
    expect(buildFtsMatchQuery('provoke')).toBe('"provoke"*');
    expect(buildFtsMatchQuery('hot dog')).toBe('"hot"* "dog"*');
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(buildFtsMatchQuery('')).toBeNull();
    expect(buildFtsMatchQuery('   \t ')).toBeNull();
  });

  it('neutralizes FTS5 operator characters by quoting', () => {
    // These would be parsed as operators / column filters if not quoted.
    expect(buildFtsMatchQuery('-foo')).toBe('"-foo"*');
    expect(buildFtsMatchQuery('a:b')).toBe('"a:b"*');
    expect(buildFtsMatchQuery('(x)')).toBe('"(x)"*');
    expect(buildFtsMatchQuery('NEAR')).toBe('"NEAR"*');
  });

  it('escapes embedded double quotes by doubling', () => {
    expect(buildFtsMatchQuery('say"hi')).toBe('"say""hi"*');
  });
});

// ---------------------------------------------------------------------------
// searchEntries — integration (FTS5 + fallback, snippets, empty query)
// ---------------------------------------------------------------------------
describe('searchEntries (DB-backed)', () => {
  let db: TestDb;
  let prisma: PrismaClient;
  let categoryId: number;

  beforeAll(async () => {
    db = createTestDb();
    prisma = db.prisma;
    const category = await prisma.category.create({
      data: { name: 'Vocabulary', viewType: 'list' },
    });
    categoryId = category.id;

    await seedEntry(prisma, categoryId, 'provoke', [
      'to **stimulate** a reaction 激起，激发',
    ]);
    await seedEntry(prisma, categoryId, 'evoke', ['to call forth a feeling']);
    await seedEntry(prisma, categoryId, 'abate', [
      'to *diminish* in intensity 减弱',
    ]);
    await seedEntry(prisma, categoryId, 'serendipity', []);
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  it('returns an empty result set for an empty query with NO DB hit', async () => {
    // Guard: a thrown error here would prove a DB access was attempted.
    const guarded = {
      $queryRawUnsafe: () => {
        throw new Error('DB should not be touched for an empty query');
      },
      entry: {
        findMany: () => {
          throw new Error('DB should not be touched for an empty query');
        },
      },
    } as unknown as PrismaClient;

    expect(await searchEntries(guarded, '')).toEqual({ query: '', results: [] });
    expect(await searchEntries(guarded, '   \t\n ')).toEqual({
      query: '',
      results: [],
    });
  });

  it('finds an entry by its word (FTS path) and builds a definition snippet', async () => {
    const { query, results } = await searchEntries(prisma, 'provoke');
    expect(query).toBe('provoke');
    const hit = results.find((r) => r.word === 'provoke');
    expect(hit).toBeDefined();
    expect(hit?.categoryName).toBe('Vocabulary');
    // Snippet is plain text extracted from the Markdown definition.
    expect(hit?.snippet).toContain('stimulate');
    expect(hit?.snippet).not.toContain('**');
    expect(hit?.snippet).toContain('激起');
  });

  it('finds an entry by its definition text', async () => {
    const { results } = await searchEntries(prisma, 'diminish');
    expect(results.map((r) => r.word)).toContain('abate');
  });

  it('matches a word substring that is not a token prefix (LIKE completeness)', async () => {
    // "voke" is not a prefix of "provoke"/"evoke", so FTS prefix matching alone
    // would miss it; the word-substring scan must still surface both.
    const { results } = await searchEntries(prisma, 'voke');
    const words = results.map((r) => r.word);
    expect(words).toContain('provoke');
    expect(words).toContain('evoke');
  });

  it('performs a case-insensitive match', async () => {
    const { results } = await searchEntries(prisma, 'PROVOKE');
    expect(results.map((r) => r.word)).toContain('provoke');
  });

  it('returns an empty result set when nothing matches', async () => {
    const { results } = await searchEntries(prisma, 'zzzznotpresent');
    expect(results).toEqual([]);
  });

  it('does not throw on adversarial FTS input and still matches via fallback', async () => {
    // Raw FTS5 special characters must never cause a throw.
    for (const adversarial of ['"', '-', '*', ':', '(', ')', 'a OR b', 'x AND', 'col:val', '^', 'a-"b(']) {
      const { results } = await searchEntries(prisma, adversarial);
      expect(Array.isArray(results)).toBe(true);
    }
    // A query that is a literal substring of a word still resolves via LIKE.
    const { results } = await searchEntries(prisma, 'serendip');
    expect(results.map((r) => r.word)).toContain('serendipity');
  });

  it('ranks exact word matches ahead of definition-only matches', async () => {
    // "evoke" exact word should outrank "provoke" whose definition is unrelated.
    const { results } = await searchEntries(prisma, 'evoke');
    expect(results[0]?.word).toBe('evoke');
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (Property 4 & Property 5)
// ---------------------------------------------------------------------------
describe('search correctness properties', () => {
  let db: TestDb;
  let prisma: PrismaClient;

  beforeAll(() => {
    db = createTestDb();
    prisma = db.prisma;
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  // Constrain generators to a tiny ASCII alphabet (mixed case) so that:
  //  - SQLite LIKE and JS String#includes share identical case-insensitivity
  //    semantics (ASCII-only folding), keeping the oracle and implementation
  //    aligned, and
  //  - short random queries frequently hit, making the properties meaningful.
  const letter = fc.constantFrom('a', 'b', 'c', 'A', 'B', 'C');
  const token = fc
    .array(letter, { minLength: 1, maxLength: 6 })
    .map((cs) => cs.join(''));
  const query = fc
    .array(letter, { minLength: 1, maxLength: 3 })
    .map((cs) => cs.join(''));

  /** Plain-text oracle: case-insensitive substring (matches the spec wording). */
  function containsCI(haystack: string, needle: string): boolean {
    return haystack.toLowerCase().includes(needle.toLowerCase());
  }

  interface SeedEntry {
    word: string;
    definitions: string[];
  }

  // Distinct words (within the single category) so @@unique([word, categoryId])
  // is satisfied. Each entry carries 0-2 plain-text definitions.
  const entriesArb = fc
    .uniqueArray(
      fc.record({
        word: token,
        definitions: fc.array(token, { minLength: 0, maxLength: 2 }),
      }),
      { minLength: 1, maxLength: 8, selector: (e) => e.word },
    );

  async function reseed(entries: SeedEntry[]): Promise<void> {
    // Entry has onDelete: RESTRICT on its category FK, so clear entries first.
    await prisma.entry.deleteMany({});
    await prisma.category.deleteMany({});
    const category = await prisma.category.create({
      data: { name: 'PropCat', viewType: 'list' },
    });
    for (const e of entries) {
      await seedEntry(prisma, category.id, e.word, e.definitions);
    }
  }

  it('Property 4 (search soundness): every result contains the query in word or definition text', async () => {
    // **Validates: Requirements 6.2, 6.3**
    await fc.assert(
      fc.asyncProperty(entriesArb, query, async (entries, q) => {
        await reseed(entries);
        const { results } = await searchEntries(prisma, q, {
          limit: DEFAULT_SEARCH_LIMIT,
        });
        for (const r of results) {
          const entry = entries.find((e) => e.word === r.word)!;
          const defText = entry.definitions.join(' ');
          expect(containsCI(r.word, q) || containsCI(defText, q)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  }, 120_000);

  it('Property 5 (search completeness): every entry whose word contains the query appears in results', async () => {
    // **Validates: Requirements 6.2, 6.3**
    await fc.assert(
      fc.asyncProperty(entriesArb, query, async (entries, q) => {
        await reseed(entries);
        // Limit >= number of seeded entries, so completeness is not affected by
        // truncation (the property is asserted within the result limit).
        const { results } = await searchEntries(prisma, q, {
          limit: Math.max(DEFAULT_SEARCH_LIMIT, entries.length),
        });
        const returnedWords = new Set(results.map((r) => r.word));
        for (const e of entries) {
          if (containsCI(e.word, q)) {
            expect(returnedWords.has(e.word)).toBe(true);
          }
        }
      }),
      { numRuns: 40 },
    );
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Performance benchmark (Requirements 6.5, 11.2): < 200ms for 10,000 entries
// ---------------------------------------------------------------------------
describe('search performance (10,000 entries)', () => {
  let db: TestDb;
  let prisma: PrismaClient;
  const ENTRY_COUNT = 10_000;

  beforeAll(async () => {
    db = createTestDb();
    prisma = db.prisma;

    const category = await prisma.category.create({
      data: { name: 'Bench', viewType: 'list' },
    });

    // Bulk-insert entries in a single transaction. The FTS5 sync triggers fire
    // per row, so this is the dominant cost of seeding (acknowledged in the
    // task). Entries are `term0`..`term9999` with one definition each.
    const data = Array.from({ length: ENTRY_COUNT }, (_, i) => ({
      word: `term${i}`,
      categoryId: category.id,
    }));
    await prisma.entry.createMany({ data });

    // Attach one definition to each entry (also trigger-synced into FTS).
    const entries = await prisma.entry.findMany({
      where: { categoryId: category.id },
      select: { id: true, word: true },
    });
    await prisma.definition.createMany({
      data: entries.map((e) => ({
        entryId: e.id,
        text: `definition for ${e.word} 含义`,
      })),
    });
  }, 300_000);

  afterAll(async () => {
    await db.cleanup();
  });

  it('seeds exactly 10,000 entries', async () => {
    expect(await prisma.entry.count()).toBe(ENTRY_COUNT);
  });

  it('returns a representative query within 200ms', async () => {
    // Warm up caches/connection so the measurement reflects steady-state query
    // cost rather than first-call overhead.
    await searchEntries(prisma, 'term4242');

    const start = performance.now();
    const { results } = await searchEntries(prisma, 'term4242');
    const elapsed = performance.now() - start;

    // Representative exact-ish query resolves to the single matching entry.
    expect(results.map((r) => r.word)).toContain('term4242');
    // Requirement 6.5 / 11.2: < 200ms for up to 10,000 entries.
    expect(elapsed).toBeLessThan(200);
  }, 60_000);
});
