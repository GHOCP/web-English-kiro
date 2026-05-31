// Document normalization for round-trip comparison (Property 1 & Property 3).
//
// The migration round-trip and export/import inverse properties must compare
// two documents "modulo auto-generated IDs and timestamps". This module strips
// the volatile `exportedAt` timestamp (and, optionally, image fields that
// legitimately change when a source image is re-copied + re-thumbnailed by
// Sharp), while preserving everything that must be stable: the category tree
// shape, names, viewType/partOfSpeech, entry words, pronunciations, entryType,
// notes, displayOrder, and — crucially — every definition/example `text` field
// byte-for-byte (Property 3).
//
//   - Property 3 (export/import inverse): images are inserted verbatim (no
//     re-encoding), so `includeImageFiles: true` keeps filenames in the
//     comparison and the round-trip is a true byte-for-byte inverse.
//   - Property 1 (migration round-trip with real image processing): Sharp
//     generates fresh random filenames + re-encoded sizes, so
//     `includeImageFiles: false` compares only the stable image alt text.
//
// Requirements: 7.4, 8.2
import type {
  ExportDocument,
  ExportedCategory,
  ExportedEntry,
} from '@/types';
import type {
  ImportCategory,
  ImportDocument,
  ImportEntry,
} from './types';

export interface NormalizedImage {
  filename?: string;
  thumbnailFilename?: string;
  fileSize?: number;
  altText: string | null;
}

export interface NormalizedEntry {
  word: string;
  pronunciation: string | null;
  entryType: string;
  notes: string | null;
  displayOrder: number;
  definitions: { text: string; partOfSpeech: string | null; displayOrder: number }[];
  examples: { text: string; displayOrder: number }[];
  images: NormalizedImage[];
}

export interface NormalizedCategory {
  name: string;
  viewType: string;
  partOfSpeech: string | null;
  displayOrder: number;
  entries: NormalizedEntry[];
  children: NormalizedCategory[];
}

export interface NormalizeOptions {
  /**
   * Include generated image filenames + fileSize in the result. Use `true` for
   * the verbatim export/import inverse (Property 3); `false` when source images
   * are re-processed by Sharp (Property 1).
   */
  includeImageFiles?: boolean;
}

type AnyEntry = ExportedEntry | ImportEntry;
type AnyCategory = ExportedCategory | ImportCategory;
type AnyDocument = ExportDocument | ImportDocument;

function normalizeEntry(entry: AnyEntry, opts: NormalizeOptions): NormalizedEntry {
  return {
    word: entry.word,
    pronunciation: entry.pronunciation ?? null,
    entryType: entry.entryType,
    notes: entry.notes ?? null,
    displayOrder: entry.displayOrder,
    // Preserve order + text exactly (byte-for-byte Markdown — Property 3).
    definitions: entry.definitions.map((d) => ({
      text: d.text,
      partOfSpeech: d.partOfSpeech ?? null,
      displayOrder: d.displayOrder,
    })),
    examples: entry.examples.map((e) => ({ text: e.text, displayOrder: e.displayOrder })),
    images: entry.images.map((img) =>
      opts.includeImageFiles
        ? {
            filename: img.filename,
            thumbnailFilename: img.thumbnailFilename,
            fileSize: img.fileSize,
            altText: img.altText ?? null,
          }
        : { altText: img.altText ?? null },
    ),
  };
}

function normalizeCategory(
  category: AnyCategory,
  opts: NormalizeOptions,
): NormalizedCategory {
  return {
    name: category.name,
    viewType: category.viewType,
    partOfSpeech: category.partOfSpeech ?? null,
    displayOrder: category.displayOrder,
    entries: category.entries.map((e) => normalizeEntry(e, opts)),
    children: category.children.map((c) => normalizeCategory(c, opts)),
  };
}

/**
 * Project a document down to the content-stable structure used for round-trip
 * equality assertions. The `exportedAt` timestamp is always dropped; image
 * filenames are kept only when `includeImageFiles` is set.
 */
export function normalizeDocument(
  document: AnyDocument,
  options: NormalizeOptions = { includeImageFiles: true },
): NormalizedCategory[] {
  return document.categories.map((c) => normalizeCategory(c, options));
}
