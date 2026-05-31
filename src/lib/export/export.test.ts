import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '@/test/testDb';
import type { ExportDocument, ExportedCategory } from '@/types';
import {
  buildExportDocument,
  exportCollection,
  serializeJson,
  serializeCsv,
  serializeMarkdown,
  escapeCsvField,
  CSV_COLUMNS,
  EXPORT_VERSION,
} from './index';

/**
 * Export API tests (Task 11).
 *
 * Cover the four serializer behaviors and the data-fetch/scoping logic:
 *   - JSON structure + round-trippable shape (byte-for-byte text, ordering)
 *   - CSV columns + RFC 4180 escaping
 *   - Markdown headings + content
 *   - single-category subtree scoping vs whole-collection forest
 *
 * Property 3 (export/import inverse) is fully validated in Task 14 once import
 * exists; here we exercise the export side and provide a reusable round-trip
 * scaffolding helper (`exportThenParseJson`).
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

// ---------------------------------------------------------------------------
// Round-trip scaffolding: export JSON and parse it back into an ExportDocument.
// Task 14 will pair this with `import(...)` to validate Property 3 end-to-end.
// ---------------------------------------------------------------------------
async function exportThenParseJson(
  prisma: PrismaClient,
  categoryId?: number,
): Promise<ExportDocument> {
  const { body } = await exportCollection(prisma, { format: 'json', categoryId });
  return JSON.parse(body) as ExportDocument;
}

function findCategory(
  categories: ExportedCategory[],
  name: string,
): ExportedCategory | undefined {
  for (const cat of categories) {
    if (cat.name === name) return cat;
    const nested = findCategory(cat.children, name);
    if (nested) return nested;
  }
  return undefined;
}

describe('export serializers (pure functions)', () => {
  describe('escapeCsvField (RFC 4180)', () => {
    it('leaves plain fields untouched', () => {
      expect(escapeCsvField('provoke')).toBe('provoke');
    });

    it('quotes and doubles embedded quotes', () => {
      expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    });

    it('quotes fields containing commas', () => {
      expect(escapeCsvField('a, b, c')).toBe('"a, b, c"');
    });

    it('quotes fields containing newlines', () => {
      expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
      expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
    });
  });

  describe('serializeMarkdown', () => {
    it('returns an empty string for an empty document', () => {
      const doc: ExportDocument = {
        version: EXPORT_VERSION,
        exportedAt: '2024-01-01T00:00:00.000Z',
        categories: [],
      };
      expect(serializeMarkdown(doc)).toBe('');
    });

    it('renders nested headings and entry list items', () => {
      const doc: ExportDocument = {
        version: EXPORT_VERSION,
        exportedAt: '2024-01-01T00:00:00.000Z',
        categories: [
          {
            name: 'Vocabulary',
            displayOrder: 0,
            viewType: 'list',
            partOfSpeech: null,
            entries: [
              {
                word: 'provoke',
                pronunciation: '/prəˈvəʊk/',
                entryType: 'word',
                notes: null,
                displayOrder: 0,
                definitions: [
                  { text: '激起 **stimulate**', partOfSpeech: 'V', displayOrder: 0 },
                ],
                examples: [{ text: 'It *provoked* laughter.', displayOrder: 0 }],
                images: [],
              },
            ],
            children: [
              {
                name: 'Thesaurus',
                displayOrder: 0,
                viewType: 'thesaurus',
                partOfSpeech: 'V',
                entries: [],
                children: [],
              },
            ],
          },
        ],
      };

      const md = serializeMarkdown(doc);
      expect(md).toContain('# Vocabulary');
      expect(md).toContain('## Thesaurus');
      expect(md).toContain('- **provoke** /prəˈvəʊk/');
      // Stored Markdown is preserved as-is in the output.
      expect(md).toContain('激起 **stimulate**');
      expect(md).toContain('It *provoked* laughter.');
    });
  });
});

describe('export from database (buildExportDocument + serializers)', () => {
  let db: TestDb;
  let prisma: PrismaClient;

  // Captured ids for scoping assertions.
  let vocabularyId = 0;
  let thesaurusId = 0;
  let accretionId = 0;

  beforeAll(async () => {
    db = createTestDb();
    prisma = db.prisma;

    // ---- Seed a small forest -------------------------------------------
    // Vocabulary (root)
    //   └─ Thesaurus (child)  → entry "provoke"
    //   └─ entry "set" (directly under root)
    // Accretion (root)        → entry "fig"
    const vocabulary = await prisma.category.create({
      data: { name: 'Vocabulary', viewType: 'list', displayOrder: 0 },
    });
    vocabularyId = vocabulary.id;

    const thesaurus = await prisma.category.create({
      data: {
        name: 'Thesaurus',
        viewType: 'thesaurus',
        partOfSpeech: 'V',
        parentId: vocabulary.id,
        displayOrder: 0,
      },
    });
    thesaurusId = thesaurus.id;

    const accretion = await prisma.category.create({
      data: { name: 'Accretion', viewType: 'genre', displayOrder: 1 },
    });
    accretionId = accretion.id;

    // Entry under the thesaurus subcategory, with mixed-language Markdown and
    // tricky characters (comma, quote, newline) to exercise escaping.
    await prisma.entry.create({
      data: {
        word: 'provoke',
        pronunciation: '/prəˈvəʊk/',
        categoryId: thesaurus.id,
        entryType: 'word',
        notes: 'note with, comma and "quote"',
        displayOrder: 0,
        definitions: {
          create: [
            { text: '激起，激发 to **stimulate**', partOfSpeech: 'V', displayOrder: 0 },
            { text: 'line one\nline two', partOfSpeech: 'V', displayOrder: 1 },
          ],
        },
        examples: {
          create: [{ text: 'The remark *provoked* laughter. 引起了笑声。', displayOrder: 0 }],
        },
        images: {
          create: [
            { filename: 'p.jpg', thumbnailFilename: 'p.thumb.jpg', altText: 'alt', fileSize: 42 },
          ],
        },
      },
    });

    // Entry directly under the Vocabulary root (no subcategory).
    await prisma.entry.create({
      data: {
        word: 'set',
        categoryId: vocabulary.id,
        displayOrder: 1,
        definitions: { create: [{ text: 'put in place 放置', displayOrder: 0 }] },
      },
    });

    // Entry in the second top-level category.
    await prisma.entry.create({
      data: {
        word: 'fig',
        categoryId: accretion.id,
        definitions: { create: [{ text: '无花果', displayOrder: 0 }] },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  it('builds a nested round-trippable JSON document for the whole collection', async () => {
    const doc = await buildExportDocument(prisma, { format: 'json' });

    expect(doc.version).toBe(EXPORT_VERSION);
    expect(typeof doc.exportedAt).toBe('string');
    expect(() => new Date(doc.exportedAt).toISOString()).not.toThrow();

    // Two top-level categories, ordered by displayOrder.
    expect(doc.categories.map((c) => c.name)).toEqual(['Vocabulary', 'Accretion']);

    const vocab = doc.categories[0];
    // Child category present + nested entry.
    expect(vocab.children.map((c) => c.name)).toEqual(['Thesaurus']);
    const thesaurus = vocab.children[0];
    expect(thesaurus.viewType).toBe('thesaurus');
    expect(thesaurus.partOfSpeech).toBe('V');

    const provoke = thesaurus.entries.find((e) => e.word === 'provoke')!;
    expect(provoke).toBeDefined();
    // Text fields preserved byte-for-byte (mixed language + Markdown + newline).
    expect(provoke.pronunciation).toBe('/prəˈvəʊk/');
    expect(provoke.definitions[0].text).toBe('激起，激发 to **stimulate**');
    expect(provoke.definitions[1].text).toBe('line one\nline two');
    expect(provoke.examples[0].text).toBe('The remark *provoked* laughter. 引起了笑声。');
    expect(provoke.notes).toBe('note with, comma and "quote"');
    expect(provoke.images[0]).toEqual({
      filename: 'p.jpg',
      thumbnailFilename: 'p.thumb.jpg',
      altText: 'alt',
      fileSize: 42,
    });

    // Definitions are emitted in displayOrder.
    expect(provoke.definitions.map((d) => d.displayOrder)).toEqual([0, 1]);
  });

  it('JSON serialization is parseable and stable through a parse cycle', async () => {
    const doc = await buildExportDocument(prisma, { format: 'json' });
    const json = serializeJson(doc);
    const reparsed = JSON.parse(json) as ExportDocument;
    expect(reparsed).toEqual(doc);
  });

  it('round-trip scaffolding helper exports + parses JSON back to a document', async () => {
    // Task 14 will pair `exportThenParseJson` with an importer to validate
    // Property 3 fully. Here we just confirm the export side produces a clean,
    // re-parseable document equal to the freshly-built one.
    const built = await buildExportDocument(prisma, { format: 'json' });
    const roundTripped = await exportThenParseJson(prisma);
    // exportedAt is a timestamp captured per-call; compare the data payload.
    expect(roundTripped.categories).toEqual(built.categories);
    expect(roundTripped.version).toBe(built.version);
  });

  it('scopes export to a single category subtree when categoryId is given', async () => {
    const doc = await buildExportDocument(prisma, {
      format: 'json',
      categoryId: vocabularyId,
    });

    // Only the Vocabulary subtree is the single top-level node.
    expect(doc.categories).toHaveLength(1);
    expect(doc.categories[0].name).toBe('Vocabulary');
    // Accretion (a sibling top-level category) is excluded.
    expect(findCategory(doc.categories, 'Accretion')).toBeUndefined();
    // The nested thesaurus + its entry are included.
    expect(findCategory(doc.categories, 'Thesaurus')).toBeDefined();
    expect(
      findCategory(doc.categories, 'Thesaurus')!.entries.map((e) => e.word),
    ).toContain('provoke');
  });

  it('scopes to a leaf subcategory (only its own entries)', async () => {
    const doc = await buildExportDocument(prisma, {
      format: 'json',
      categoryId: thesaurusId,
    });
    expect(doc.categories).toHaveLength(1);
    expect(doc.categories[0].name).toBe('Thesaurus');
    expect(doc.categories[0].entries.map((e) => e.word)).toEqual(['provoke']);
    expect(doc.categories[0].children).toHaveLength(0);
  });

  it('throws for an unknown categoryId', async () => {
    await expect(
      buildExportDocument(prisma, { format: 'json', categoryId: 999999 }),
    ).rejects.toThrow(/not found/i);
  });

  it('produces a flat CSV with the required columns and proper escaping', async () => {
    const { body, contentType, filename } = await exportCollection(prisma, {
      format: 'csv',
    });

    expect(contentType).toContain('text/csv');
    expect(filename).toMatch(/\.csv$/);

    const lines = body.split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));

    // The "provoke" row: definitions joined with " | ", fields with commas /
    // quotes / newlines wrapped in quotes.
    const provokeLine = lines.find((l) => l.startsWith('provoke'))!;
    expect(provokeLine).toBeDefined();
    // Multi-value join delimiter is present between the two definitions.
    expect(provokeLine).toContain(' | ');
    // A field containing a comma is quoted.
    expect(provokeLine).toContain('"激起，激发 to **stimulate** | line one\nline two"');
    // category = top-level root (Vocabulary); subcategory = direct owner.
    expect(provokeLine).toContain('Vocabulary');
    expect(provokeLine).toContain('Thesaurus');

    // The "set" row sits directly under the root → empty subcategory column.
    const setLine = lines.find((l) => l.startsWith('set'))!;
    expect(setLine).toBeDefined();
    expect(setLine.endsWith('Vocabulary,')).toBe(true);
  });

  it('produces human-readable Markdown with category headings', async () => {
    const { body, contentType, filename } = await exportCollection(prisma, {
      format: 'markdown',
    });

    expect(contentType).toContain('text/markdown');
    expect(filename).toMatch(/\.md$/);

    expect(body).toContain('# Vocabulary');
    expect(body).toContain('## Thesaurus');
    expect(body).toContain('# Accretion');
    expect(body).toContain('- **provoke** /prəˈvəʊk/');
    // Stored Markdown preserved as-is.
    expect(body).toContain('激起，激发 to **stimulate**');
    expect(body).toContain('The remark *provoked* laughter. 引起了笑声。');
  });

  it('exportCollection sets JSON content type and filename metadata', async () => {
    const { contentType, filename } = await exportCollection(prisma, {
      format: 'json',
    });
    expect(contentType).toContain('application/json');
    expect(filename).toMatch(/^lexical-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('builds a scoped filename when categoryId is provided', async () => {
    const { filename } = await exportCollection(prisma, {
      format: 'csv',
      categoryId: accretionId,
    });
    expect(filename).toMatch(
      new RegExp(`^lexical-category-${accretionId}-\\d{4}-\\d{2}-\\d{2}\\.csv$`),
    );
  });
});
