import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from './testDb';

/**
 * Migration / schema validation tests (Task 2).
 *
 * These run the committed Prisma migrations (schema + FTS5 raw SQL) against a
 * fresh SQLite database and assert that the data model behaves as the design
 * specifies: relations, cascade deletes, duplicate prevention, nesting, the
 * declared indexes, and FTS5 trigger-driven synchronization.
 *
 * Requirements: NFR 1.2, NFR 1.3, NFR 3.3, 3.1, 6.5
 */
describe('Prisma schema & migration', () => {
  let db: TestDb;
  let prisma: PrismaClient;

  beforeAll(() => {
    db = createTestDb();
    prisma = db.prisma;
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  it('creates the full entry graph (Category → Entry → Definition/Example/Image)', async () => {
    const category = await prisma.category.create({
      data: { name: 'Vocabulary', viewType: 'list' },
    });

    const entry = await prisma.entry.create({
      data: {
        word: 'provoke',
        pronunciation: '/prəˈvəʊk/',
        categoryId: category.id,
        notes: 'mixed **English** and 中文 notes',
        definitions: {
          create: [
            { text: '激起，激发 to **stimulate** a reaction', partOfSpeech: 'V', displayOrder: 0 },
          ],
        },
        examples: { create: [{ text: 'The remark *provoked* laughter. 这句话引起了笑声。' }] },
        images: {
          create: [
            { filename: 'a.jpg', thumbnailFilename: 'a.thumb.jpg', altText: 'alt', fileSize: 1234 },
          ],
        },
      },
      include: { definitions: true, examples: true, images: true, category: true },
    });

    expect(entry.id).toBeGreaterThan(0);
    expect(entry.category.name).toBe('Vocabulary');
    expect(entry.definitions).toHaveLength(1);
    expect(entry.examples).toHaveLength(1);
    expect(entry.images).toHaveLength(1);
    // Mixed-language Markdown stored verbatim (NFR 1.2, design Q6+Q13).
    expect(entry.definitions[0].text).toContain('激起');
    expect(entry.examples[0].text).toContain('这句话引起了笑声');
    expect(entry.images[0].thumbnailFilename).toBe('a.thumb.jpg');
  });

  it('enforces @@unique([word, categoryId]) — duplicate prevention (NFR 3.3)', async () => {
    const category = await prisma.category.create({ data: { name: 'DupCat' } });
    await prisma.entry.create({ data: { word: 'set', categoryId: category.id } });

    // Same word in the same category is rejected.
    await expect(
      prisma.entry.create({ data: { word: 'set', categoryId: category.id } }),
    ).rejects.toThrow();

    // Same word in a different category is allowed.
    const other = await prisma.category.create({ data: { name: 'OtherCat' } });
    const ok = await prisma.entry.create({ data: { word: 'set', categoryId: other.id } });
    expect(ok.id).toBeGreaterThan(0);
  });

  it('cascade-deletes definitions, examples, and images with their entry (NFR 3.3, 3.1)', async () => {
    const category = await prisma.category.create({ data: { name: 'CascadeCat' } });
    const entry = await prisma.entry.create({
      data: {
        word: 'cascade',
        categoryId: category.id,
        definitions: { create: [{ text: 'def 1' }, { text: 'def 2' }] },
        examples: { create: [{ text: 'ex 1' }] },
        images: { create: [{ filename: 'c.jpg', thumbnailFilename: 'c.thumb.jpg', fileSize: 1 }] },
      },
    });

    await prisma.entry.delete({ where: { id: entry.id } });

    // No orphaned children remain (Property 7 foundation).
    expect(await prisma.definition.count({ where: { entryId: entry.id } })).toBe(0);
    expect(await prisma.example.count({ where: { entryId: entry.id } })).toBe(0);
    expect(await prisma.image.count({ where: { entryId: entry.id } })).toBe(0);
  });

  it('supports a category tree at least 3 levels deep (NFR 1.3)', async () => {
    const root = await prisma.category.create({
      data: { name: 'Vocab', viewType: 'thesaurus', partOfSpeech: 'V' },
    });
    const level2 = await prisma.category.create({
      data: { name: 'Verb group', parentId: root.id },
    });
    const level3 = await prisma.category.create({
      data: { name: '激起。激发', parentId: level2.id },
    });

    const loaded = await prisma.category.findUnique({
      where: { id: root.id },
      include: { children: { include: { children: true } } },
    });

    expect(loaded?.partOfSpeech).toBe('V');
    expect(loaded?.children[0].id).toBe(level2.id);
    expect(loaded?.children[0].children[0].id).toBe(level3.id);
  });

  it('declares the expected indexes (NFR 1.3, performance)', async () => {
    const indexes = await prisma.$queryRawUnsafe<{ name: string; tbl_name: string }[]>(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index'",
    );
    const names = indexes.map((i) => i.name);

    expect(names).toContain('Category_parentId_idx');
    expect(names).toContain('Category_displayOrder_idx');
    expect(names).toContain('Entry_categoryId_idx');
    expect(names).toContain('Entry_word_idx');
    expect(names).toContain('Entry_word_categoryId_key');
  });
});

/**
 * FTS5 full-text index validation (Requirements 6.5, 3.1).
 * Confirms the virtual table exists and that the sync triggers keep it aligned
 * with Entry/Definition mutations.
 */
describe('FTS5 search index', () => {
  let db: TestDb;
  let prisma: PrismaClient;

  beforeAll(() => {
    db = createTestDb();
    prisma = db.prisma;
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  async function ftsMatch(query: string): Promise<number[]> {
    const rows = await prisma.$queryRawUnsafe<{ rowid: number }[]>(
      'SELECT rowid FROM "EntryFts" WHERE "EntryFts" MATCH ? ORDER BY rowid',
      query,
    );
    return rows.map((r) => Number(r.rowid));
  }

  it('exists as an FTS5 virtual table with sync triggers', async () => {
    const objects = await prisma.$queryRawUnsafe<{ type: string; name: string }[]>(
      "SELECT type, name FROM sqlite_master WHERE name = 'EntryFts' OR name LIKE '%_fts'",
    );
    const names = objects.map((o) => o.name);
    expect(names).toContain('EntryFts');
    for (const trigger of [
      'Entry_ai_fts',
      'Entry_ad_fts',
      'Entry_au_fts',
      'Definition_ai_fts',
      'Definition_ad_fts',
      'Definition_au_fts',
    ]) {
      expect(names).toContain(trigger);
    }
  });

  it('indexes the word on entry insert', async () => {
    const category = await prisma.category.create({ data: { name: 'FtsCat1' } });
    const entry = await prisma.entry.create({
      data: { word: 'serendipity', categoryId: category.id },
    });

    expect(await ftsMatch('serendipity')).toContain(entry.id);
  });

  it('indexes definition text via the definition trigger', async () => {
    const category = await prisma.category.create({ data: { name: 'FtsCat2' } });
    const entry = await prisma.entry.create({
      data: { word: 'abate', categoryId: category.id },
    });
    await prisma.definition.create({
      data: { entryId: entry.id, text: 'to **diminish** in intensity 减弱' },
    });

    // Searchable by definition content, not just the word.
    expect(await ftsMatch('diminish')).toContain(entry.id);
  });

  it('updates the index when the word changes', async () => {
    const category = await prisma.category.create({ data: { name: 'FtsCat3' } });
    const entry = await prisma.entry.create({
      data: { word: 'oldword', categoryId: category.id },
    });
    await prisma.entry.update({ where: { id: entry.id }, data: { word: 'newword' } });

    expect(await ftsMatch('oldword')).not.toContain(entry.id);
    expect(await ftsMatch('newword')).toContain(entry.id);
  });

  it('removes the index row when the entry is deleted', async () => {
    const category = await prisma.category.create({ data: { name: 'FtsCat4' } });
    const entry = await prisma.entry.create({
      data: { word: 'ephemeral', categoryId: category.id },
    });
    expect(await ftsMatch('ephemeral')).toContain(entry.id);

    await prisma.entry.delete({ where: { id: entry.id } });
    expect(await ftsMatch('ephemeral')).not.toContain(entry.id);
  });

  it('refreshes concatenated definitions when a definition is removed', async () => {
    const category = await prisma.category.create({ data: { name: 'FtsCat5' } });
    const entry = await prisma.entry.create({
      data: { word: 'compound', categoryId: category.id },
    });
    const d1 = await prisma.definition.create({
      data: { entryId: entry.id, text: 'alpha uniquetokenaaa' },
    });
    await prisma.definition.create({
      data: { entryId: entry.id, text: 'beta uniquetokenbbb' },
    });

    expect(await ftsMatch('uniquetokenaaa')).toContain(entry.id);
    expect(await ftsMatch('uniquetokenbbb')).toContain(entry.id);

    await prisma.definition.delete({ where: { id: d1.id } });

    expect(await ftsMatch('uniquetokenaaa')).not.toContain(entry.id);
    expect(await ftsMatch('uniquetokenbbb')).toContain(entry.id);
  });
});
