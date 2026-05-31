// Shared types for the migration pipeline.
//
// The migration JSON deliberately reuses the canonical `ExportDocument` /
// `Exported*` shapes (design "Export Design" + "Migration Pipeline") so that a
// single importer (`importDocument`) loads BOTH freshly-migrated pages AND the
// JSON produced by the Export API — and so the export→import round-trip
// (Property 3) and migration round-trip (Property 1) exercise one schema.
//
// The only addition over `ExportedImage` is an optional `sourcePath`: a
// reference to the legacy image (relative to the page's source directory) that
// the importer copies into `uploads/` and thumbnails with Sharp (R4.5).
// Round-tripped documents simply omit it, so `ExportDocument` is assignable to
// `ImportDocument` unchanged.
//
// Requirements: 7.3, 7.4, 4.5, 8.2
import type {
  ExportDocument,
  ExportedCategory,
  ExportedEntry,
  ExportedImage,
} from '@/types';

/** An image with an optional reference to its legacy source file. */
export interface ImportImage extends ExportedImage {
  /**
   * Path to the source image relative to the page's source directory
   * (e.g. `img/pak-choi.jpg`). Present for migration documents; absent for
   * round-tripped export documents. When present, the importer copies the file
   * into `uploads/` and fills in the real `filename`/`thumbnailFilename`/
   * `fileSize`.
   */
  sourcePath?: string;
}

/** An entry whose images may carry a `sourcePath`. */
export interface ImportEntry extends Omit<ExportedEntry, 'images'> {
  images: ImportImage[];
}

/** A category whose entries/children use the import-aware shapes. */
export interface ImportCategory extends Omit<ExportedCategory, 'entries' | 'children'> {
  entries: ImportEntry[];
  children: ImportCategory[];
}

/**
 * The migration/import document. Structurally a superset of
 * {@link ExportDocument} (images may add `sourcePath`), so any `ExportDocument`
 * is a valid `ImportDocument`.
 */
export interface ImportDocument extends Omit<ExportDocument, 'categories'> {
  categories: ImportCategory[];
}

/** The kind of legacy page being parsed (drives table-structure detection). */
export type PageType = 'thesaurus' | 'genre' | 'look-around';

/** Options for parsing a single legacy page. */
export interface ParsePageOptions {
  /** The page kind. When omitted, {@link detectPageType} infers it. */
  pageType?: PageType;
  /** Name for the page's top-level category (e.g. "Thesaurus"). */
  categoryName: string;
  /** displayOrder for the page's top-level category (default 0). */
  displayOrder?: number;
}

/** Result of parsing a page: the document plus non-fatal warnings. */
export interface ParseResult {
  document: ImportDocument;
  /** Human-readable notes about skipped rows, duplicates, etc. */
  warnings: string[];
}
