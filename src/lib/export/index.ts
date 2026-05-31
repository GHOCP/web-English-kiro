// Export library entry point (R8).
//
// Fetches the collection (or a single-category subtree) from the database,
// builds the canonical round-trippable `ExportDocument` tree, and dispatches to
// the requested format serializer (JSON / CSV / Markdown).
//
// The exported `exportCollection` is the single reusable surface the route
// handler (`/api/export`) calls; Task 14's export/import round-trip property
// test (Property 3) also reuses `buildExportDocument` so the export side is
// ready to pair with import.
//
// Scope (R8.5):
//   - `categoryId` omitted → export the whole collection as a forest of
//     top-level categories.
//   - `categoryId` provided → export that category's subtree (the category as
//     the single top-level node, recursively including child categories and
//     their entries).
//
// Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
import type { PrismaClient } from '@prisma/client';
import type {
  ExportDocument,
  ExportedCategory,
  ExportedEntry,
  ExportFormat,
} from '@/types';
import { serializeJson } from './json';
import { serializeCsv } from './csv';
import { serializeMarkdown } from './markdown';

export { serializeJson } from './json';
export { serializeCsv, escapeCsvField, CSV_COLUMNS } from './csv';
export { serializeMarkdown } from './markdown';

/** Schema version embedded in the JSON export for forward-compatibility. */
export const EXPORT_VERSION = 1;

/** Options accepted by {@link exportCollection} / {@link buildExportDocument}. */
export interface ExportOptions {
  format: ExportFormat;
  /** Omit to export the whole collection; provide to scope to a subtree. */
  categoryId?: number;
}

/** Result of {@link exportCollection}: serialized body + transport metadata. */
export interface ExportResult {
  body: string;
  contentType: string;
  /** Suggested download filename (`Content-Disposition`). */
  filename: string;
}

// ---------------------------------------------------------------------------
// Data shape fetched from Prisma (entries + nested relations).
// ---------------------------------------------------------------------------

interface RawCategory {
  id: number;
  name: string;
  parentId: number | null;
  displayOrder: number;
  viewType: string;
  partOfSpeech: string | null;
}

interface RawEntry {
  id: number;
  word: string;
  pronunciation: string | null;
  categoryId: number;
  entryType: string;
  notes: string | null;
  displayOrder: number;
  definitions: {
    text: string;
    partOfSpeech: string | null;
    displayOrder: number;
  }[];
  examples: { text: string; displayOrder: number }[];
  images: {
    filename: string;
    thumbnailFilename: string;
    altText: string | null;
    fileSize: number;
  }[];
}

// ---------------------------------------------------------------------------
// Tree assembly.
// ---------------------------------------------------------------------------

/** Sort helper: by displayOrder ascending, then id for a stable total order. */
function byDisplayOrder<T extends { displayOrder: number; id: number }>(
  a: T,
  b: T,
): number {
  return a.displayOrder - b.displayOrder || a.id - b.id;
}

function toExportedEntry(entry: RawEntry): ExportedEntry {
  return {
    word: entry.word,
    pronunciation: entry.pronunciation,
    entryType: entry.entryType,
    notes: entry.notes,
    displayOrder: entry.displayOrder,
    definitions: [...entry.definitions]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((d) => ({
        text: d.text,
        partOfSpeech: d.partOfSpeech,
        displayOrder: d.displayOrder,
      })),
    examples: [...entry.examples]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((e) => ({ text: e.text, displayOrder: e.displayOrder })),
    images: entry.images.map((img) => ({
      filename: img.filename,
      thumbnailFilename: img.thumbnailFilename,
      altText: img.altText,
      fileSize: img.fileSize,
    })),
  };
}

/**
 * Recursively build an {@link ExportedCategory} from a category id, using the
 * pre-fetched lookup maps. Children and entries are emitted in stable
 * display order.
 */
function buildCategoryNode(
  categoryId: number,
  categoryById: Map<number, RawCategory>,
  childrenByParent: Map<number | null, RawCategory[]>,
  entriesByCategory: Map<number, RawEntry[]>,
): ExportedCategory {
  const category = categoryById.get(categoryId)!;
  const childCategories = (childrenByParent.get(categoryId) ?? [])
    .slice()
    .sort(byDisplayOrder);
  const entries = (entriesByCategory.get(categoryId) ?? [])
    .slice()
    .sort(byDisplayOrder);

  return {
    name: category.name,
    displayOrder: category.displayOrder,
    viewType: category.viewType,
    partOfSpeech: category.partOfSpeech,
    entries: entries.map(toExportedEntry),
    children: childCategories.map((child) =>
      buildCategoryNode(child.id, categoryById, childrenByParent, entriesByCategory),
    ),
  };
}

/**
 * Fetch the collection (or subtree) and assemble the round-trippable
 * {@link ExportDocument}. Reused by both the route handler and Task 14's
 * round-trip property test.
 *
 * @throws Error when `categoryId` is provided but no such category exists.
 */
export async function buildExportDocument(
  prisma: PrismaClient,
  options: ExportOptions = { format: 'json' },
): Promise<ExportDocument> {
  const { categoryId } = options;

  const categories = (await prisma.category.findMany({
    select: {
      id: true,
      name: true,
      parentId: true,
      displayOrder: true,
      viewType: true,
      partOfSpeech: true,
    },
  })) as RawCategory[];

  const entries = (await prisma.entry.findMany({
    include: {
      definitions: true,
      examples: true,
      images: true,
    },
  })) as unknown as RawEntry[];

  const categoryById = new Map<number, RawCategory>();
  for (const c of categories) categoryById.set(c.id, c);

  const childrenByParent = new Map<number | null, RawCategory[]>();
  for (const c of categories) {
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }

  const entriesByCategory = new Map<number, RawEntry[]>();
  for (const e of entries) {
    const list = entriesByCategory.get(e.categoryId) ?? [];
    list.push(e);
    entriesByCategory.set(e.categoryId, list);
  }

  let roots: RawCategory[];
  if (categoryId === undefined) {
    // Whole collection: the forest of top-level categories.
    roots = (childrenByParent.get(null) ?? []).slice().sort(byDisplayOrder);
  } else {
    const root = categoryById.get(categoryId);
    if (!root) {
      throw new Error(`Category ${categoryId} not found`);
    }
    roots = [root];
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    categories: roots.map((root) =>
      buildCategoryNode(root.id, categoryById, childrenByParent, entriesByCategory),
    ),
  };
}

// ---------------------------------------------------------------------------
// Format dispatch + transport metadata.
// ---------------------------------------------------------------------------

const FORMAT_META: Record<
  ExportFormat,
  { contentType: string; extension: string }
> = {
  json: { contentType: 'application/json; charset=utf-8', extension: 'json' },
  csv: { contentType: 'text/csv; charset=utf-8', extension: 'csv' },
  markdown: { contentType: 'text/markdown; charset=utf-8', extension: 'md' },
};

function serialize(format: ExportFormat, doc: ExportDocument): string {
  switch (format) {
    case 'json':
      return serializeJson(doc);
    case 'csv':
      return serializeCsv(doc);
    case 'markdown':
      return serializeMarkdown(doc);
    default: {
      // Exhaustiveness guard — unreachable for valid ExportFormat values.
      const _never: never = format;
      throw new Error(`Unsupported export format: ${String(_never)}`);
    }
  }
}

/**
 * Build a download filename for the export, e.g.
 * `lexical-export-2024-01-02.json` or `lexical-category-5-2024-01-02.csv`.
 */
function buildFilename(options: ExportOptions): string {
  const { format, categoryId } = options;
  const { extension } = FORMAT_META[format];
  const date = new Date().toISOString().slice(0, 10);
  const scope =
    categoryId === undefined ? 'export' : `category-${categoryId}`;
  return `lexical-${scope}-${date}.${extension}`;
}

/**
 * Top-level export operation reused by the `/api/export` route handler.
 * Fetches the data, serializes to the requested format, and returns the body
 * alongside the `Content-Type` and suggested download filename.
 */
export async function exportCollection(
  prisma: PrismaClient,
  options: ExportOptions,
): Promise<ExportResult> {
  const doc = await buildExportDocument(prisma, options);
  const body = serialize(options.format, doc);
  return {
    body,
    contentType: FORMAT_META[options.format].contentType,
    filename: buildFilename(options),
  };
}
