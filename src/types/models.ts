// Domain model types for the Lexical Resources System.
//
// Where sensible these are derived from Prisma's generated types
// (`Prisma.<Model>GetPayload<...>`) so they stay in lock-step with the schema
// in `prisma/schema.prisma`. The base record types (`Category`, `Entry`,
// `Definition`, `Example`, `Image`) are re-exported directly from
// `@prisma/client`.
//
// Requirements: NFR 1.1, NFR 1.3
import type { Prisma } from '@prisma/client';

// Re-export the generated base record types so callers can import everything
// domain-related from `@/types` without reaching into `@prisma/client`.
export type {
  Category,
  Entry,
  Definition,
  Example,
  Image,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Enumerated string fields (modeled as String in SQLite/Prisma).
// Keeping them as named unions gives callers compile-time safety without
// requiring a Prisma enum (unsupported on SQLite at schema level here).
// ---------------------------------------------------------------------------

/** How a category's contents should be rendered. */
export type CategoryViewType =
  | 'list'
  | 'thesaurus'
  | 'genre'
  | 'writing'
  | 'speaking';

/** Part-of-speech grouping used by thesaurus categories. */
export type CategoryPartOfSpeech = 'V' | 'N' | 'ADJ' | 'Collection';

/** The kind of lexical entry, which drives the read/detail view chosen. */
export type EntryType =
  | 'word'
  | 'phrase'
  | 'structure'
  | 'expression'
  | 'speaking';

// ---------------------------------------------------------------------------
// Category tree (R1, R5, R9) — recursive structure for the sidebar / nav.
// ---------------------------------------------------------------------------

/**
 * A category plus its (recursively nested) children, as returned by
 * `GET /api/categories`. Built from the flat `Category` rows into a tree.
 * Supports the 3+ nesting levels required by the design.
 */
export type CategoryTreeNode = Prisma.CategoryGetPayload<{}> & {
  children: CategoryTreeNode[];
};

/** The full category forest (top-level categories, each with nested children). */
export type CategoryTree = CategoryTreeNode[];

/** A category together with its direct children only (one level). */
export type CategoryWithChildren = Prisma.CategoryGetPayload<{
  include: { children: true };
}>;

// ---------------------------------------------------------------------------
// Entry with relations (R2, R3, R4) — used by entry detail / list views.
// ---------------------------------------------------------------------------

/** An entry including its definitions, examples, and images (no category). */
export type EntryWithDetails = Prisma.EntryGetPayload<{
  include: {
    definitions: true;
    examples: true;
    images: true;
  };
}>;

/** An entry including all relations plus its owning category. */
export type EntryWithRelations = Prisma.EntryGetPayload<{
  include: {
    definitions: true;
    examples: true;
    images: true;
    category: true;
  };
}>;

/** A category together with its fully-populated entries. */
export type CategoryWithEntries = Prisma.CategoryGetPayload<{
  include: {
    entries: {
      include: {
        definitions: true;
        examples: true;
        images: true;
      };
    };
  };
}>;
