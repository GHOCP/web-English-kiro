import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '@/test/testDb';
import {
  getCategoryTree,
  createCategory,
  updateCategory,
  deleteCategory,
  validateDeleteCategory,
  CategoryError,
} from '@/lib/categories';

/**
 * Category service tests (Task 7).
 *
 * Exercises the framework-free service layer behind the Category API against a
 * fully-migrated isolated SQLite database (FTS5 triggers included), so the same
 * code path used by the route handlers is validated without an HTTP server.
 *
 * Covers unit/example behaviour plus the three correctness properties owned by
 * this task:
 *   - Property 2 — tree integrity / no cycles      (Requirements 1.4, 1.5)
 *   - Property 8 — display-order stability          (Requirement 1.3)
 *   - Property 9 — category deletion safety         (Requirement 1.5)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 9.1, 9.4
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

/** Remove all data so each test/property-run starts from an empty collection. */
async function reset(): Promise<void> {
  await prisma.entry.deleteMany();
  await prisma.category.deleteMany();
}

// ---------------------------------------------------------------------------
// Invariant checks shared by the property tests.
// ---------------------------------------------------------------------------

interface CatRow {
  id: number;
  parentId: number | null;
  displayOrder: number;
}

/** Property 2: no category is its own ancestor and no parentId is dangling. */
function assertNoCycles(cats: CatRow[]): void {
  const parentOf = new Map<number, number | null>(
    cats.map((c) => [c.id, c.parentId]),
  );
  for (const start of cats) {
    const seen = new Set<number>();
    let cur: number | null = start.id;
    while (cur != null) {
      const current: number = cur;
      expect(
        seen.has(current),
        `cycle detected involving category ${start.id}`,
      ).toBe(false);
      seen.add(current);
      const parent: number | null = parentOf.get(current) ?? null;
      if (parent != null) {
        expect(
          parentOf.has(parent),
          `dangling parentId ${parent} referenced by ${current}`,
        ).toBe(true);
      }
      cur = parent;
    }
  }
}

/** Property 8: every sibling group is a strict, gap-free 0..n-1 ordering. */
function assertSiblingOrdering(cats: CatRow[]): void {
  const groups = new Map<string, number[]>();
  for (const c of cats) {
    const key = c.parentId === null ? 'root' : `p${c.parentId}`;
    const arr = groups.get(key);
    if (arr) arr.push(c.displayOrder);
    else groups.set(key, [c.displayOrder]);
  }
  for (const [key, orders] of groups) {
    const sorted = [...orders].sort((a, b) => a - b);
    const expected = Array.from({ length: sorted.length }, (_, i) => i);
    expect(sorted, `sibling group ${key} ordering`).toEqual(expected);
  }
}

/** Property 2 (part 2): every entry references an existing category. */
async function assertEntriesReferenceExistingCategories(): Promise<void> {
  const cats = await prisma.category.findMany({ select: { id: true } });
  const ids = new Set(cats.map((c) => c.id));
  const entries = await prisma.entry.findMany({ select: { categoryId: true } });
  for (const e of entries) {
    expect(ids.has(e.categoryId), `entry references missing category ${e.categoryId}`).toBe(
      true,
    );
  }
}

async function checkAllInvariants(): Promise<void> {
  const cats = await prisma.category.findMany({
    select: { id: true, parentId: true, displayOrder: true },
  });
  assertNoCycles(cats);
  assertSiblingOrdering(cats);
  await assertEntriesReferenceExistingCategories();
}

// ===========================================================================
// Unit / example-based tests
// ===========================================================================

describe('getCategoryTree', () => {
  afterEach(reset);

  it('builds a nested tree ordered by displayOrder', async () => {
    const root = await createCategory(prisma, { name: 'Vocabulary' });
    const a = await createCategory(prisma, { name: 'A', parentId: root.id });
    const b = await createCategory(prisma, { name: 'B', parentId: root.id });
    // Force B before A.
    await updateCategory(prisma, b.id, { displayOrder: 0 });

    const tree = await getCategoryTree(prisma);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(root.id);
    expect(tree[0].children.map((c) => c.name)).toEqual(['B', 'A']);
  });

  it('supports at least 3 levels of nesting (R1.4)', async () => {
    const l1 = await createCategory(prisma, { name: 'L1' });
    const l2 = await createCategory(prisma, { name: 'L2', parentId: l1.id });
    const l3 = await createCategory(prisma, { name: 'L3', parentId: l2.id });

    const tree = await getCategoryTree(prisma);
    expect(tree[0].children[0].id).toBe(l2.id);
    expect(tree[0].children[0].children[0].id).toBe(l3.id);
  });
});

describe('createCategory', () => {
  afterEach(reset);

  it('creates a thesaurus group with viewType + partOfSpeech (R9.1, R9.4)', async () => {
    const cat = await createCategory(prisma, {
      name: 'Verbs',
      viewType: 'thesaurus',
      partOfSpeech: 'V',
    });
    expect(cat.viewType).toBe('thesaurus');
    expect(cat.partOfSpeech).toBe('V');
  });

  it('appends to the end of the sibling group by default', async () => {
    const root = await createCategory(prisma, { name: 'root' });
    const first = await createCategory(prisma, { name: '1', parentId: root.id });
    const second = await createCategory(prisma, { name: '2', parentId: root.id });
    expect(first.displayOrder).toBe(0);
    expect(second.displayOrder).toBe(1);
  });

  it('inserts at the requested index and renumbers siblings (R1.1, R1.3)', async () => {
    const root = await createCategory(prisma, { name: 'root' });
    await createCategory(prisma, { name: 'a', parentId: root.id }); // 0
    await createCategory(prisma, { name: 'b', parentId: root.id }); // 1
    const c = await createCategory(prisma, {
      name: 'c',
      parentId: root.id,
      displayOrder: 0,
    });
    expect(c.displayOrder).toBe(0);

    const children = await prisma.category.findMany({
      where: { parentId: root.id },
      orderBy: { displayOrder: 'asc' },
    });
    expect(children.map((x) => `${x.name}:${x.displayOrder}`)).toEqual([
      'c:0',
      'a:1',
      'b:2',
    ]);
  });

  it('rejects a non-existent parent with a 400 CategoryError', async () => {
    await expect(
      createCategory(prisma, { name: 'orphan', parentId: 99999 }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('updateCategory', () => {
  afterEach(reset);

  it('renames a category (R1.2)', async () => {
    const cat = await createCategory(prisma, { name: 'Old' });
    const updated = await updateCategory(prisma, cat.id, { name: 'New' });
    expect(updated.name).toBe('New');
  });

  it('moves a category under a new parent and renumbers both groups', async () => {
    const p1 = await createCategory(prisma, { name: 'P1' });
    const p2 = await createCategory(prisma, { name: 'P2' });
    const childA = await createCategory(prisma, { name: 'A', parentId: p1.id });
    const childB = await createCategory(prisma, { name: 'B', parentId: p1.id });

    const moved = await updateCategory(prisma, childA.id, { parentId: p2.id });
    expect(moved.parentId).toBe(p2.id);

    // P1 now has only B, renumbered to 0.
    const p1Children = await prisma.category.findMany({
      where: { parentId: p1.id },
    });
    expect(p1Children).toHaveLength(1);
    expect(p1Children[0].id).toBe(childB.id);
    expect(p1Children[0].displayOrder).toBe(0);
  });

  it('rejects moving a category under itself (Property 2 / R1.4)', async () => {
    const cat = await createCategory(prisma, { name: 'self' });
    await expect(
      updateCategory(prisma, cat.id, { parentId: cat.id }),
    ).rejects.toBeInstanceOf(CategoryError);
  });

  it('rejects moving a category under one of its descendants (Property 2)', async () => {
    const root = await createCategory(prisma, { name: 'root' });
    const child = await createCategory(prisma, { name: 'child', parentId: root.id });
    const grand = await createCategory(prisma, { name: 'grand', parentId: child.id });

    await expect(
      updateCategory(prisma, root.id, { parentId: grand.id }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('throws 404 for a missing category', async () => {
    await expect(
      updateCategory(prisma, 4242, { name: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('deleteCategory', () => {
  afterEach(reset);

  it('reassigns contained entries to the target then removes the category (R1.5, Property 9)', async () => {
    const source = await createCategory(prisma, { name: 'Source' });
    const target = await createCategory(prisma, { name: 'Target' });
    await prisma.entry.create({ data: { word: 'alpha', categoryId: source.id } });
    await prisma.entry.create({ data: { word: 'beta', categoryId: source.id } });

    const result = await deleteCategory(prisma, source.id, {
      mode: 'reassign',
      reassignToCategoryId: target.id,
    });

    expect(result.affectedEntryCount).toBe(2);
    expect(result.deletedCategoryIds).toContain(source.id);
    expect(await prisma.category.findUnique({ where: { id: source.id } })).toBeNull();
    const targetEntries = await prisma.entry.findMany({
      where: { categoryId: target.id },
    });
    expect(targetEntries.map((e) => e.word).sort()).toEqual(['alpha', 'beta']);
  });

  it('cascade-deletes entries (and their FTS rows) with the subtree (R1.5, Property 9)', async () => {
    const root = await createCategory(prisma, { name: 'Root' });
    const child = await createCategory(prisma, { name: 'Child', parentId: root.id });
    const e1 = await prisma.entry.create({
      data: {
        word: 'cascadeword',
        categoryId: child.id,
        definitions: { create: [{ text: 'to fall like a waterfall' }] },
      },
    });

    const result = await deleteCategory(prisma, root.id, { mode: 'cascade' });

    expect(result.deletedCategoryIds.sort()).toEqual([root.id, child.id].sort());
    expect(await prisma.entry.count()).toBe(0);
    expect(await prisma.definition.count()).toBe(0);
    // FTS row removed via the delete trigger (route delete through Prisma).
    const fts = await prisma.$queryRawUnsafe<{ rowid: number }[]>(
      'SELECT rowid FROM "EntryFts" WHERE "EntryFts" MATCH ?',
      'cascadeword',
    );
    expect(fts.map((r) => Number(r.rowid))).not.toContain(e1.id);
  });

  it('rejects reassign to a category inside the deleted subtree (R1.5)', async () => {
    const root = await createCategory(prisma, { name: 'Root' });
    const child = await createCategory(prisma, { name: 'Child', parentId: root.id });
    await prisma.entry.create({ data: { word: 'x', categoryId: root.id } });

    await expect(
      deleteCategory(prisma, root.id, {
        mode: 'reassign',
        reassignToCategoryId: child.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
    // Nothing was deleted (transaction rolled back).
    expect(await prisma.category.count()).toBe(2);
  });

  it('rejects reassign to a non-existent target', async () => {
    const source = await createCategory(prisma, { name: 'Source' });
    await expect(
      deleteCategory(prisma, source.id, {
        mode: 'reassign',
        reassignToCategoryId: 99999,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('validateDeleteCategory', () => {
  it('requires an explicit mode (Q18 — no default)', () => {
    const result = validateDeleteCategory({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0].field).toBe('mode');
    }
  });

  it('requires reassignToCategoryId in reassign mode', () => {
    const result = validateDeleteCategory({ mode: 'reassign' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0].field).toBe('reassignToCategoryId');
    }
  });

  it('accepts a valid cascade request', () => {
    const result = validateDeleteCategory({ mode: 'cascade' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mode).toBe('cascade');
  });

  it('accepts a valid reassign request', () => {
    const result = validateDeleteCategory({
      mode: 'reassign',
      reassignToCategoryId: 7,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reassignToCategoryId).toBe(7);
  });
});

// ===========================================================================
// Property-based tests
// ===========================================================================

describe('Property 2 — category tree integrity / no cycles', () => {
  afterEach(reset);

  // A unique word generator keeps reassign moves free of (word, categoryId)
  // collisions so the property exercises structure, not the uniqueness guard.
  let wordCounter = 0;

  type Op =
    | { kind: 'createCat'; sel: number; useParent: boolean }
    | { kind: 'createEntry'; sel: number }
    | { kind: 'move'; targetSel: number; parentSel: number; useRoot: boolean; order: number }
    | { kind: 'delete'; targetSel: number; mode: 'reassign' | 'cascade'; reassignSel: number };

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      kind: fc.constant('createCat' as const),
      sel: fc.double({ min: 0, max: 0.999, noNaN: true }),
      useParent: fc.boolean(),
    }),
    fc.record({
      kind: fc.constant('createEntry' as const),
      sel: fc.double({ min: 0, max: 0.999, noNaN: true }),
    }),
    fc.record({
      kind: fc.constant('move' as const),
      targetSel: fc.double({ min: 0, max: 0.999, noNaN: true }),
      parentSel: fc.double({ min: 0, max: 0.999, noNaN: true }),
      useRoot: fc.boolean(),
      order: fc.integer({ min: 0, max: 6 }),
    }),
    fc.record({
      kind: fc.constant('delete' as const),
      targetSel: fc.double({ min: 0, max: 0.999, noNaN: true }),
      mode: fc.constantFrom('reassign' as const, 'cascade' as const),
      reassignSel: fc.double({ min: 0, max: 0.999, noNaN: true }),
    }),
  );

  function pick<T extends { id: number }>(rows: T[], sel: number): T | null {
    if (rows.length === 0) return null;
    return rows[Math.min(rows.length - 1, Math.floor(sel * rows.length))];
  }

  it('keeps the tree acyclic and entries valid across arbitrary op sequences', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 16 }), async (ops) => {
        await reset();

        for (const op of ops) {
          const cats = await prisma.category.findMany({ select: { id: true } });
          try {
            if (op.kind === 'createCat') {
              const parent = op.useParent ? pick(cats, op.sel) : null;
              await createCategory(prisma, {
                name: `cat-${Math.random().toString(36).slice(2, 8)}`,
                parentId: parent ? parent.id : null,
              });
            } else if (op.kind === 'createEntry') {
              const cat = pick(cats, op.sel);
              if (cat) {
                wordCounter += 1;
                await prisma.entry.create({
                  data: { word: `w${wordCounter}`, categoryId: cat.id },
                });
              }
            } else if (op.kind === 'move') {
              const target = pick(cats, op.targetSel);
              const parent = op.useRoot ? null : pick(cats, op.parentSel);
              if (target) {
                await updateCategory(prisma, target.id, {
                  parentId: parent ? parent.id : null,
                  displayOrder: op.order,
                });
              }
            } else {
              const target = pick(cats, op.targetSel);
              if (target) {
                if (op.mode === 'reassign') {
                  const reTo = pick(cats, op.reassignSel);
                  await deleteCategory(prisma, target.id, {
                    mode: 'reassign',
                    reassignToCategoryId: reTo ? reTo.id : target.id,
                  });
                } else {
                  await deleteCategory(prisma, target.id, { mode: 'cascade' });
                }
              }
            }
          } catch (err) {
            // Rejected operations (cycle, missing parent/target, collisions)
            // are expected and must leave the invariants intact — which the
            // post-checks below verify. Re-throw anything unexpected.
            if (!(err instanceof CategoryError)) throw err;
          }

          await checkAllInvariants();
        }
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});

describe('Property 8 — display order stability', () => {
  afterEach(reset);

  it('reordering produces a strict, gap-free total order within a sibling set (R1.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 6 }),
        fc.array(
          fc.record({
            itemSel: fc.double({ min: 0, max: 0.999, noNaN: true }),
            toIndex: fc.integer({ min: 0, max: 8 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (count, moves) => {
          await reset();
          const root = await createCategory(prisma, { name: 'root' });
          for (let i = 0; i < count; i += 1) {
            await createCategory(prisma, { name: `c${i}`, parentId: root.id });
          }

          for (const mv of moves) {
            const siblings = await prisma.category.findMany({
              where: { parentId: root.id },
              orderBy: { displayOrder: 'asc' },
              select: { id: true },
            });
            const target = siblings[Math.min(siblings.length - 1, Math.floor(mv.itemSel * siblings.length))];
            await updateCategory(prisma, target.id, { displayOrder: mv.toIndex });

            // Invariant after every reorder: strict 0..n-1 ordering, no dups/gaps.
            const after = await prisma.category.findMany({
              where: { parentId: root.id },
              orderBy: { displayOrder: 'asc' },
              select: { displayOrder: true },
            });
            const orders = after.map((x) => x.displayOrder);
            expect(orders).toEqual(orders.map((_, i) => i));
          }
        },
      ),
      { numRuns: 30 },
    );
  }, 120_000);
});

describe('Property 9 — category deletion safety', () => {
  afterEach(reset);

  let wc = 0;
  const uniqueWord = (): string => {
    wc += 1;
    return `pw${wc}`;
  };

  it('reassign mode moves every subtree entry to the target and loses none (R1.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }), // number of child categories under root
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 4 }), // entries per node
        async (childCount, entriesPer) => {
          await reset();
          const root = await createCategory(prisma, { name: 'root' });
          const target = await createCategory(prisma, { name: 'target' });

          const subtreeCatIds = [root.id];
          for (let i = 0; i < childCount; i += 1) {
            const child = await createCategory(prisma, {
              name: `c${i}`,
              parentId: root.id,
            });
            subtreeCatIds.push(child.id);
          }

          // Distribute entries across the subtree categories.
          let expectedMoved = 0;
          for (let i = 0; i < subtreeCatIds.length; i += 1) {
            const n = entriesPer[i % entriesPer.length] ?? 0;
            for (let j = 0; j < n; j += 1) {
              await prisma.entry.create({
                data: { word: uniqueWord(), categoryId: subtreeCatIds[i] },
              });
              expectedMoved += 1;
            }
          }

          const totalBefore = await prisma.entry.count();

          const result = await deleteCategory(prisma, root.id, {
            mode: 'reassign',
            reassignToCategoryId: target.id,
          });

          // No entries lost.
          expect(await prisma.entry.count()).toBe(totalBefore);
          expect(result.affectedEntryCount).toBe(expectedMoved);
          // All former subtree entries now reference the target.
          expect(
            await prisma.entry.count({ where: { categoryId: { in: subtreeCatIds } } }),
          ).toBe(0);
          expect(await prisma.entry.count({ where: { categoryId: target.id } })).toBe(
            expectedMoved,
          );
          // Subtree categories are gone; the target survives.
          expect(
            await prisma.category.count({ where: { id: { in: subtreeCatIds } } }),
          ).toBe(0);
          expect(await prisma.category.findUnique({ where: { id: target.id } })).not.toBeNull();
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);

  it('cascade mode removes every subtree entry and leaves none behind (R1.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 4 }),
        async (childCount, entriesPer) => {
          await reset();
          const root = await createCategory(prisma, { name: 'root' });
          const survivor = await createCategory(prisma, { name: 'survivor' });
          await prisma.entry.create({
            data: { word: uniqueWord(), categoryId: survivor.id },
          });

          const subtreeCatIds = [root.id];
          for (let i = 0; i < childCount; i += 1) {
            const child = await createCategory(prisma, {
              name: `c${i}`,
              parentId: root.id,
            });
            subtreeCatIds.push(child.id);
          }

          let expectedDeleted = 0;
          for (let i = 0; i < subtreeCatIds.length; i += 1) {
            const n = entriesPer[i % entriesPer.length] ?? 0;
            for (let j = 0; j < n; j += 1) {
              await prisma.entry.create({
                data: {
                  word: uniqueWord(),
                  categoryId: subtreeCatIds[i],
                  definitions: { create: [{ text: 'def' }] },
                },
              });
              expectedDeleted += 1;
            }
          }

          const result = await deleteCategory(prisma, root.id, { mode: 'cascade' });

          expect(result.affectedEntryCount).toBe(expectedDeleted);
          // No entries from the subtree remain.
          expect(
            await prisma.entry.count({ where: { categoryId: { in: subtreeCatIds } } }),
          ).toBe(0);
          // The unrelated survivor entry is untouched.
          expect(await prisma.entry.count({ where: { categoryId: survivor.id } })).toBe(1);
          // No orphaned definitions remain (cascade through Prisma → FTS in sync).
          const ftsCount = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
            'SELECT COUNT(*) as n FROM "EntryFts"',
          );
          expect(Number(ftsCount[0].n)).toBe(await prisma.entry.count());
        },
      ),
      { numRuns: 25 },
    );
  }, 120_000);
});
