// JSON → SQLite importer (R7.4, NFR 3.2, R4.5).
//
// `importDocument` is the single reusable surface that loads BOTH:
//   - freshly-migrated pages produced by `parsePage` (images carry a
//     `sourcePath`; the file is copied into uploads/ and thumbnailed), AND
//   - JSON produced by the Export API (round-trip — images carry their stored
//     `filename`/`thumbnailFilename` and are inserted verbatim).
//
// It validates the document, then performs a single transactional bulk insert
// (NFR 3.2): categories are created preserving nesting (parent before child),
// then each category's entries with their definitions/examples/images. A
// failure rolls the whole import back — no partial writes.
//
// Image files are copied + thumbnailed (via the Sharp-backed image lib) BEFORE
// the transaction opens, so the DB transaction stays short and only writes
// already-resolved metadata.
//
// Requirements: 7.4, 4.5, NFR 3.2
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { storeImage } from '@/lib/images';
import { validateImportDocument } from './validate';
import type {
  ImportCategory,
  ImportDocument,
  ImportEntry,
  ImportImage,
} from './types';

/** Options for {@link importDocument}. */
export interface ImportOptions {
  /** Override the uploads directory (tests use a temp dir). */
  uploadsDir?: string;
  /**
   * Base directory the per-image `sourcePath` values resolve against
   * (the legacy page's source directory). Required to copy migration images.
   */
  sourceDir?: string;
  /**
   * Skip copying/thumbnailing source images. When true, images that have a
   * `sourcePath` are inserted with their carried metadata (used by tests that
   * don't exercise the filesystem). Round-tripped images (no `sourcePath`) are
   * always inserted verbatim regardless of this flag.
   */
  skipImageProcessing?: boolean;
}

/** Summary of a completed import. */
export interface ImportSummary {
  categoriesCreated: number;
  entriesCreated: number;
  definitionsCreated: number;
  examplesCreated: number;
  imagesCreated: number;
  /** Non-fatal notes (e.g. an image source file that could not be read). */
  warnings: string[];
}

/** Fully-resolved image metadata ready for DB insertion. */
interface ResolvedImage {
  filename: string;
  thumbnailFilename: string;
  altText: string | null;
  fileSize: number;
}

/**
 * Resolve an image to its final stored metadata. For a migration image with a
 * `sourcePath`, the file is read, validated, copied into uploads/, and a
 * thumbnail generated (R4.5); the returned metadata reflects the stored files.
 * For a round-tripped image (no `sourcePath`, or processing skipped), the
 * carried metadata is returned unchanged so export→import is a true inverse.
 */
async function resolveImage(
  image: ImportImage,
  options: ImportOptions,
  warnings: string[],
): Promise<ResolvedImage> {
  const passthrough: ResolvedImage = {
    filename: image.filename,
    thumbnailFilename: image.thumbnailFilename,
    altText: image.altText,
    fileSize: image.fileSize,
  };

  if (!image.sourcePath || options.skipImageProcessing) {
    return passthrough;
  }
  if (!options.sourceDir) {
    warnings.push(
      `Image "${image.sourcePath}" has a sourcePath but no sourceDir was provided; inserted metadata as-is.`,
    );
    return passthrough;
  }

  const absolute = path.resolve(options.sourceDir, image.sourcePath);
  try {
    const buffer = await readFile(absolute);
    const stored = await storeImage(buffer, { uploadsDir: options.uploadsDir });
    return {
      filename: stored.filename,
      thumbnailFilename: stored.thumbnailFilename,
      altText: image.altText,
      fileSize: stored.fileSize,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to import image "${image.sourcePath}": ${reason}`);
    // Fall back to carried metadata rather than aborting the whole import.
    return passthrough;
  }
}

/** Pre-resolve every image in the tree (filesystem work, outside the txn). */
async function resolveAllImages(
  categories: ImportCategory[],
  options: ImportOptions,
  warnings: string[],
): Promise<Map<ImportImage, ResolvedImage>> {
  const resolved = new Map<ImportImage, ResolvedImage>();
  const walk = async (cats: ImportCategory[]): Promise<void> => {
    for (const cat of cats) {
      for (const entry of cat.entries) {
        for (const image of entry.images) {
          resolved.set(image, await resolveImage(image, options, warnings));
        }
      }
      await walk(cat.children);
    }
  };
  await walk(categories);
  return resolved;
}

// ---------------------------------------------------------------------------
// Insertion (inside the transaction)
// ---------------------------------------------------------------------------

interface Counts {
  categories: number;
  entries: number;
  definitions: number;
  examples: number;
  images: number;
}

async function insertEntry(
  tx: Prisma.TransactionClient,
  categoryId: number,
  entry: ImportEntry,
  displayOrder: number,
  resolvedImages: Map<ImportImage, ResolvedImage>,
  counts: Counts,
): Promise<void> {
  const definitions = entry.definitions.map((d, i) => ({
    text: d.text,
    partOfSpeech: d.partOfSpeech ?? null,
    displayOrder: d.displayOrder ?? i,
  }));
  const examples = entry.examples.map((e, i) => ({
    text: e.text,
    displayOrder: e.displayOrder ?? i,
  }));
  const images = entry.images.map((img) => {
    const r = resolvedImages.get(img)!;
    return {
      filename: r.filename,
      thumbnailFilename: r.thumbnailFilename,
      altText: r.altText,
      fileSize: r.fileSize,
    };
  });

  await tx.entry.create({
    data: {
      word: entry.word,
      pronunciation: entry.pronunciation ?? null,
      categoryId,
      entryType: entry.entryType || 'word',
      notes: entry.notes ?? null,
      displayOrder: entry.displayOrder ?? displayOrder,
      ...(definitions.length > 0 ? { definitions: { create: definitions } } : {}),
      ...(examples.length > 0 ? { examples: { create: examples } } : {}),
      ...(images.length > 0 ? { images: { create: images } } : {}),
    },
  });

  counts.entries += 1;
  counts.definitions += definitions.length;
  counts.examples += examples.length;
  counts.images += images.length;
}

async function insertCategory(
  tx: Prisma.TransactionClient,
  category: ImportCategory,
  parentId: number | null,
  displayOrder: number,
  resolvedImages: Map<ImportImage, ResolvedImage>,
  counts: Counts,
): Promise<void> {
  const created = await tx.category.create({
    data: {
      name: category.name,
      parentId,
      displayOrder: category.displayOrder ?? displayOrder,
      viewType: category.viewType || 'list',
      partOfSpeech: category.partOfSpeech ?? null,
    },
  });
  counts.categories += 1;

  // Entries first, then nested child categories (parent already exists).
  for (let i = 0; i < category.entries.length; i += 1) {
    await insertEntry(tx, created.id, category.entries[i], i, resolvedImages, counts);
  }
  for (let i = 0; i < category.children.length; i += 1) {
    await insertCategory(tx, category.children[i], created.id, i, resolvedImages, counts);
  }
}

/**
 * Validate and import a document into the database. The entire insert runs in
 * one transaction (NFR 3.2): on any error nothing is written.
 *
 * @throws Error (`Import validation failed: ...`) when the document is invalid.
 */
export async function importDocument(
  prisma: PrismaClient,
  document: ImportDocument,
  options: ImportOptions = {},
): Promise<ImportSummary> {
  const validation = validateImportDocument(document);
  if (!validation.success) {
    throw new Error(
      `Import validation failed: ${validation.errors
        .map((e) => `${e.field}: ${e.message}`)
        .join('; ')}`,
    );
  }

  const warnings: string[] = [];
  const resolvedImages = await resolveAllImages(
    document.categories,
    options,
    warnings,
  );

  const counts: Counts = {
    categories: 0,
    entries: 0,
    definitions: 0,
    examples: 0,
    images: 0,
  };

  // Bulk imports can insert thousands of rows (each firing the FTS5 sync
  // triggers), which easily exceeds Prisma's default 5s interactive-transaction
  // limit. Image files are already copied/thumbnailed before this point, so the
  // transaction only does DB writes — give it a generous ceiling so large
  // legacy pages import in one atomic shot (NFR 3.2: all-or-nothing).
  await prisma.$transaction(
    async (tx) => {
      for (let i = 0; i < document.categories.length; i += 1) {
        await insertCategory(tx, document.categories[i], null, i, resolvedImages, counts);
      }
    },
    { maxWait: 120_000, timeout: 120_000 },
  );

  return {
    categoriesCreated: counts.categories,
    entriesCreated: counts.entries,
    definitionsCreated: counts.definitions,
    examplesCreated: counts.examples,
    imagesCreated: counts.images,
    warnings,
  };
}
