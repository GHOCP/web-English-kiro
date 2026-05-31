import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import sharp from 'sharp';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '@/test/testDb';
import { buildExportDocument } from '@/lib/export';
import {
  importDocument,
  parsePage,
  validateImportDocument,
  normalizeDocument,
} from '@/lib/migration';
import type { ImportDocument } from '@/lib/migration';

/**
 * Importer + migration property tests (Task 14).
 *
 * Covers:
 *   - importDocument: transactional bulk insert preserving nesting, validation,
 *     and source-image copy + Sharp thumbnail generation (R4.5, NFR 3.2).
 *   - Property 1 (migration round-trip): for valid extracted JSON, import then
 *     export-as-JSON yields equivalent data (modulo auto-generated IDs).
 *   - Property 3 (export/import inverse): for any collection, importing the
 *     exported JSON reproduces the original (Markdown text byte-for-byte).
 *
 * DB-backed tests use the migrated test-DB harness (real schema + FTS5).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 4.5, 10.5
 * Properties: Property 1, Property 3
 */

// ---------------------------------------------------------------------------
// importDocument — structure + transactional insert
// ---------------------------------------------------------------------------
describe('importDocument (DB-backed)', () => {
  let db: TestDb;
  let prisma: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
    prisma = db.prisma;
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('inserts a nested category tree with entries/definitions/examples', async () => {
    const doc: ImportDocument = {
      version: 1,
      exportedAt: '2024-01-01T00:00:00.000Z',
      categories: [
        {
          name: 'Vocabulary',
          displayOrder: 0,
          viewType: 'list',
          partOfSpeech: null,
          entries: [],
          children: [
            {
              name: 'Thesaurus',
              displayOrder: 0,
              viewType: 'thesaurus',
              partOfSpeech: 'V',
              entries: [
                {
                  word: 'provoke',
                  pronunciation: '/prəˈvəʊk/',
                  entryType: 'word',
                  notes: null,
                  displayOrder: 0,
                  definitions: [
                    { text: '激起，激发 **stimulate**', partOfSpeech: null, displayOrder: 0 },
                    { text: 'line one\nline two', partOfSpeech: null, displayOrder: 1 },
                  ],
                  examples: [{ text: 'It *provoked* laughter. 引起笑声。', displayOrder: 0 }],
                  images: [],
                },
              ],
              children: [],
            },
          ],
        },
      ],
    };

    const summary = await importDocument(prisma, doc);
    expect(summary.categoriesCreated).toBe(2);
    expect(summary.entriesCreated).toBe(1);
    expect(summary.definitionsCreated).toBe(2);
    expect(summary.examplesCreated).toBe(1);

    // Verify nesting was preserved.
    const vocab = await prisma.category.findFirst({ where: { name: 'Vocabulary' } });
    const thesaurus = await prisma.category.findFirst({ where: { name: 'Thesaurus' } });
    expect(thesaurus?.parentId).toBe(vocab?.id);
    expect(thesaurus?.partOfSpeech).toBe('V');

    const entry = await prisma.entry.findFirst({
      where: { word: 'provoke' },
      include: { definitions: { orderBy: { displayOrder: 'asc' } }, examples: true },
    });
    expect(entry?.pronunciation).toBe('/prəˈvəʊk/');
    expect(entry?.definitions.map((d) => d.text)).toEqual([
      '激起，激发 **stimulate**',
      'line one\nline two',
    ]);
    expect(entry?.examples[0].text).toBe('It *provoked* laughter. 引起笑声。');
  });

  it('rejects an invalid document and writes nothing (transactional)', async () => {
    const bad = {
      version: 1,
      exportedAt: '2024-01-01T00:00:00.000Z',
      categories: [
        {
          name: 'Bad',
          displayOrder: 0,
          viewType: 'list',
          partOfSpeech: null,
          // duplicate word within the same category → invalid
          entries: [
            { word: 'dup', entryType: 'word', notes: null, pronunciation: null, displayOrder: 0, definitions: [], examples: [], images: [] },
            { word: 'dup', entryType: 'word', notes: null, pronunciation: null, displayOrder: 1, definitions: [], examples: [], images: [] },
          ],
          children: [],
        },
      ],
    } as unknown as ImportDocument;

    expect(validateImportDocument(bad).success).toBe(false);
    await expect(importDocument(prisma, bad)).rejects.toThrow(/validation failed/i);
    expect(await prisma.category.count()).toBe(0);
    expect(await prisma.entry.count()).toBe(0);
  });

  it('rolls back the whole insert atomically when a later row fails (NFR 3.2)', async () => {
    // The document is structurally valid (passes validation) but the second
    // entry carries a non-integer displayOrder that Prisma rejects at write
    // time — mid-transaction, AFTER the first category + entry are created.
    // A correct transactional import must leave the DB completely empty.
    const doc = {
      version: 1,
      exportedAt: '2024-01-01T00:00:00.000Z',
      categories: [
        {
          name: 'Atomic',
          displayOrder: 0,
          viewType: 'list',
          partOfSpeech: null,
          entries: [
            {
              word: 'first',
              pronunciation: null,
              entryType: 'word',
              notes: null,
              displayOrder: 0,
              definitions: [{ text: 'ok', partOfSpeech: null, displayOrder: 0 }],
              examples: [],
              images: [],
            },
            {
              word: 'second',
              pronunciation: null,
              entryType: 'word',
              notes: null,
              // Invalid at the DB layer (Int expected); not checked by validation.
              displayOrder: 'not-a-number' as unknown as number,
              definitions: [{ text: 'boom', partOfSpeech: null, displayOrder: 0 }],
              examples: [],
              images: [],
            },
          ],
          children: [],
        },
      ],
    } as unknown as ImportDocument;

    expect(validateImportDocument(doc).success).toBe(true);
    await expect(importDocument(prisma, doc)).rejects.toThrow();

    // Nothing was committed — the first entry/category were rolled back too.
    expect(await prisma.category.count()).toBe(0);
    expect(await prisma.entry.count()).toBe(0);
    expect(await prisma.definition.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// importDocument — source image copy + Sharp thumbnails (R4.5)
// ---------------------------------------------------------------------------
describe('importDocument image migration (R4.5)', () => {
  let db: TestDb;
  let prisma: PrismaClient;
  let sourceDir: string;
  let uploadsDir: string;

  beforeEach(async () => {
    db = createTestDb();
    prisma = db.prisma;
    sourceDir = mkdtempSync(join(tmpdir(), 'mig-src-'));
    uploadsDir = mkdtempSync(join(tmpdir(), 'mig-up-'));
    // Write a real PNG so Sharp can process + thumbnail it.
    mkdirSync(join(sourceDir, 'img'), { recursive: true });
    const png = await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    writeFileSync(join(sourceDir, 'img', 'spinach.png'), png);
  });

  afterEach(async () => {
    await db.cleanup();
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('copies the source image into uploads/ and generates a thumbnail', async () => {
    const doc: ImportDocument = {
      version: 1,
      exportedAt: '2024-01-01T00:00:00.000Z',
      categories: [
        {
          name: 'Words by genres',
          displayOrder: 0,
          viewType: 'genre',
          partOfSpeech: null,
          entries: [
            {
              word: 'spinach',
              pronunciation: '/ˈspɪnɪtʃ/',
              entryType: 'word',
              notes: null,
              displayOrder: 0,
              definitions: [{ text: '菠菜', partOfSpeech: null, displayOrder: 0 }],
              examples: [],
              images: [
                {
                  filename: 'spinach.png',
                  thumbnailFilename: '',
                  altText: 'spinach',
                  fileSize: 0,
                  sourcePath: 'img/spinach.png',
                },
              ],
            },
          ],
          children: [],
        },
      ],
    };

    const summary = await importDocument(prisma, doc, { sourceDir, uploadsDir });
    expect(summary.imagesCreated).toBe(1);
    expect(summary.warnings).toEqual([]);

    const image = await prisma.image.findFirst();
    expect(image).not.toBeNull();
    // Sharp assigned a generated uuid filename + a thumbnail.
    expect(image!.filename).toMatch(/\.png$/);
    expect(image!.thumbnailFilename).toMatch(/\.thumb\.png$/);
    expect(image!.fileSize).toBeGreaterThan(0);
    expect(image!.altText).toBe('spinach');

    // Both files exist in uploads/.
    const files = readdirSync(uploadsDir);
    expect(files).toContain(image!.filename);
    expect(files).toContain(image!.thumbnailFilename);
  });

  it('warns (does not throw) when a source image file is missing', async () => {
    const doc: ImportDocument = {
      version: 1,
      exportedAt: '2024-01-01T00:00:00.000Z',
      categories: [
        {
          name: 'G',
          displayOrder: 0,
          viewType: 'genre',
          partOfSpeech: null,
          entries: [
            {
              word: 'missing',
              pronunciation: null,
              entryType: 'word',
              notes: null,
              displayOrder: 0,
              definitions: [{ text: 'x', partOfSpeech: null, displayOrder: 0 }],
              examples: [],
              images: [
                { filename: 'nope.jpg', thumbnailFilename: '', altText: null, fileSize: 0, sourcePath: 'img/nope.jpg' },
              ],
            },
          ],
          children: [],
        },
      ],
    };
    const summary = await importDocument(prisma, doc, { sourceDir, uploadsDir });
    expect(summary.warnings.length).toBeGreaterThan(0);
    expect(summary.warnings[0]).toMatch(/Failed to import image/i);
    // The entry + image record are still created (with carried metadata).
    expect(await prisma.image.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Property 1: migration round-trip
// ---------------------------------------------------------------------------
describe('Property 1: migration round-trip', () => {
  let db: TestDb;
  let prisma: PrismaClient;

  beforeEach(() => {
    db = createTestDb();
    prisma = db.prisma;
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('importing then exporting parsed HTML yields equivalent data (modulo IDs)', async () => {
    // **Validates: Requirements 7.4, 8.2**
    const html = `
<article><div id="content">
  <h1 id="A">V.</h1>
  <h2 id="1">刺激。激发</h2>
  <table>
    <tbody>
      <tr>
        <td>provoke</td>
        <td>1. to cause a reaction 激起<br />2. ~ sb to annoy 挑衅</td>
        <td>foment</td>
        <td>/fə(ʊ)'ment/<br />vt. 煽动</td>
      </tr>
    </tbody>
  </table>
  <h2 id="3">压制</h2>
  <table>
    <tbody>
      <tr><td>subdue</td><td>/səbˈduː/<br />vn. 制服</td><td></td><td></td></tr>
    </tbody>
  </table>
</div></article>`;

    const { document } = parsePage(html, { categoryName: 'Thesaurus', pageType: 'thesaurus' });

    // Import the parsed JSON, then export it back out as a JSON document.
    await importDocument(prisma, document);
    const exported = await buildExportDocument(prisma, { format: 'json' });

    // Compare modulo auto-generated IDs / timestamps (normalized tree + text).
    expect(normalizeDocument(exported)).toEqual(normalizeDocument(document));
  });
});

// ---------------------------------------------------------------------------
// Property 3: export/import inverse — arbitrary collections (fast-check)
// ---------------------------------------------------------------------------
describe('Property 3: export/import inverse', () => {
  // A generator for arbitrary valid collections: a category tree (depth ≤ 3)
  // with entries carrying definitions/examples/images metadata. Words are kept
  // unique within each category (the @@unique constraint); category names are
  // unique within a sibling set is NOT required by the schema, but we keep the
  // tree small so export ordering (displayOrder, then id) is deterministic.

  // Mixed-language Markdown-ish text incl. tricky characters (newline, quote,
  // comma, CJK, Markdown markers) to prove byte-for-byte text preservation.
  const textArb = fc
    .array(
      fc.constantFrom(
        'to **stimulate**',
        '激起，激发',
        'line one\nline two',
        'say "hi"',
        '*italic* 斜体',
        'a, b, c',
        '1. first 2. second',
        '~ sb (into sth)',
      ),
      { minLength: 1, maxLength: 3 },
    )
    .map((parts) => parts.join(' '));

  const pronunciationArb = fc.option(
    fc.constantFrom('/prəˈvəʊk/', '/ˈspɪnɪtʃ/', '/səbˈduː/'),
    { nil: null },
  );

  const imageArb = fc.record({
    filename: fc.constantFrom('a.jpg', 'b.png', 'c.webp'),
    thumbnailFilename: fc.constantFrom('a.thumb.jpg', 'b.thumb.png', 'c.thumb.webp'),
    altText: fc.option(fc.constantFrom('alt one', '图片', 'with, comma'), { nil: null }),
    fileSize: fc.integer({ min: 1, max: 5_000_000 }),
  });

  const entryArb = fc.record({
    word: fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim().length > 0),
    pronunciation: pronunciationArb,
    entryType: fc.constantFrom('word', 'phrase', 'structure', 'expression', 'speaking'),
    notes: fc.option(textArb, { nil: null }),
    definitions: fc.array(textArb, { minLength: 0, maxLength: 3 }),
    examples: fc.array(textArb, { minLength: 0, maxLength: 2 }),
    images: fc.array(imageArb, { minLength: 0, maxLength: 2 }),
  });

  // A category node generator with bounded depth.
  function categoryArb(depth: number): fc.Arbitrary<RawCategory> {
    const childArb =
      depth <= 0
        ? fc.constant([] as RawCategory[])
        : fc.array(categoryArb(depth - 1), { minLength: 0, maxLength: 2 });
    return fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
      viewType: fc.constantFrom('list', 'thesaurus', 'genre', 'writing', 'speaking'),
      partOfSpeech: fc.option(fc.constantFrom('V', 'N', 'ADJ', 'Collection'), { nil: null }),
      entries: fc.array(entryArb, { minLength: 0, maxLength: 4 }),
      children: childArb,
    });
  }

  interface RawEntry {
    word: string;
    pronunciation: string | null;
    entryType: string;
    notes: string | null;
    definitions: string[];
    examples: string[];
    images: { filename: string; thumbnailFilename: string; altText: string | null; fileSize: number }[];
  }
  interface RawCategory {
    name: string;
    viewType: string;
    partOfSpeech: string | null;
    entries: RawEntry[];
    children: RawCategory[];
  }

  /**
   * Convert the loosely-generated tree into a valid ImportDocument: assign
   * displayOrder, de-duplicate words within each category (drop later
   * duplicates), and shape definitions/examples/images into Exported* records.
   */
  function toDocument(rawRoots: RawCategory[]): ImportDocument {
    let order = 0;
    const buildCategory = (raw: RawCategory): ImportDocument['categories'][number] => {
      const seen = new Set<string>();
      const entries = raw.entries
        .filter((e) => {
          const key = e.word.trim();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((e, i) => ({
          word: e.word.trim(),
          pronunciation: e.pronunciation,
          entryType: e.entryType,
          notes: e.notes,
          displayOrder: i,
          definitions: e.definitions.map((text, di) => ({ text, partOfSpeech: null, displayOrder: di })),
          examples: e.examples.map((text, ei) => ({ text, displayOrder: ei })),
          images: e.images.map((img) => ({ ...img })),
        }));
      return {
        name: raw.name.trim() || `cat${order++}`,
        displayOrder: order++,
        viewType: raw.viewType,
        partOfSpeech: raw.partOfSpeech,
        entries,
        children: raw.children.map(buildCategory),
      };
    };
    return {
      version: 1,
      exportedAt: '2024-01-01T00:00:00.000Z',
      categories: rawRoots.map(buildCategory),
    };
  }

  it('import(export_json(collection)) reproduces the original (text byte-for-byte)', async () => {
    // **Validates: Requirements 8.2, 7.4**
    await fc.assert(
      fc.asyncProperty(
        fc.array(categoryArb(2), { minLength: 1, maxLength: 3 }),
        async (rawRoots) => {
          const document = toDocument(rawRoots);

          // Seed DB #1 from the generated document, export it, then re-import
          // the exported JSON into a fresh DB #2 and export again.
          const dbA = createTestDb();
          const dbB = createTestDb();
          try {
            await importDocument(dbA.prisma, document);
            const exportedA = await buildExportDocument(dbA.prisma, { format: 'json' });

            // Round-trip the exported JSON through (de)serialization, as the
            // CLI would, then import into the second DB.
            const roundTripped = JSON.parse(JSON.stringify(exportedA)) as ImportDocument;
            await importDocument(dbB.prisma, roundTripped);
            const exportedB = await buildExportDocument(dbB.prisma, { format: 'json' });

            // The two exports must be equal modulo IDs/timestamps; images are
            // inserted verbatim (no re-encoding) so filenames are compared too.
            const a = normalizeDocument(exportedA, { includeImageFiles: true });
            const b = normalizeDocument(exportedB, { includeImageFiles: true });
            expect(b).toEqual(a);
            // And the first export equals the original generated document.
            expect(a).toEqual(normalizeDocument(document, { includeImageFiles: true }));
          } finally {
            await dbA.cleanup();
            await dbB.cleanup();
          }
        },
      ),
      { numRuns: 25 },
    );
  }, 180_000);
});
