// CSV export serializer (R8.3).
//
// Produces a flat CSV with the columns required by the design:
//   word, pronunciation, definitions, examples, category, subcategory
//
// Because CSV is inherently flat while the collection is a forest of nested
// categories, the export is intentionally lossy (only JSON is round-trippable —
// Property 3). For each entry we record:
//   - `category`    → the top-level (root) category name in the entry's path
//   - `subcategory` → the entry's direct owning category name, or "" when the
//                     entry lives directly under a top-level category
// Intermediate path segments (4+ levels deep) are not represented in CSV.
//
// Markdown text is preserved as-is inside cells; multiple definitions/examples
// are joined with " | ". Every field is escaped per RFC 4180: a field is
// wrapped in double quotes when it contains a quote, comma, or newline, and any
// embedded double quote is doubled.
//
// Requirements: 8.3, 8.5
import type { ExportDocument, ExportedCategory, ExportedEntry } from '@/types';

/** Delimiter used to join multiple definitions/examples within one cell. */
export const CSV_MULTI_VALUE_DELIMITER = ' | ';

/** RFC 4180 record separator. */
const CSV_ROW_SEPARATOR = '\r\n';

/** Column order for the flat CSV export. */
export const CSV_COLUMNS = [
  'word',
  'pronunciation',
  'definitions',
  'examples',
  'category',
  'subcategory',
] as const;

/**
 * Escape a single CSV field per RFC 4180. Fields containing a double quote,
 * comma, carriage return, or line feed are wrapped in double quotes with
 * embedded quotes doubled. All other fields are emitted verbatim.
 */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

interface FlatRow {
  word: string;
  pronunciation: string;
  definitions: string;
  examples: string;
  category: string;
  subcategory: string;
}

function entryToRow(
  entry: ExportedEntry,
  rootName: string,
  owningName: string,
): FlatRow {
  return {
    word: entry.word,
    pronunciation: entry.pronunciation ?? '',
    definitions: entry.definitions
      .map((d) => d.text)
      .join(CSV_MULTI_VALUE_DELIMITER),
    examples: entry.examples
      .map((e) => e.text)
      .join(CSV_MULTI_VALUE_DELIMITER),
    category: rootName,
    // Direct owner is the "subcategory"; blank when the entry sits directly on
    // a top-level category (owner === root).
    subcategory: owningName === rootName ? '' : owningName,
  };
}

/**
 * Depth-first flatten of a category subtree into CSV rows. `rootName` stays
 * fixed at the top-level category for the whole subtree; `category.name` is the
 * direct owner of the entries at this level.
 */
function flattenCategory(category: ExportedCategory, rootName: string): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const entry of category.entries) {
    rows.push(entryToRow(entry, rootName, category.name));
  }
  for (const child of category.children) {
    rows.push(...flattenCategory(child, rootName));
  }
  return rows;
}

/** Serialize an {@link ExportDocument} to an RFC 4180 CSV string. */
export function serializeCsv(doc: ExportDocument): string {
  const rows: FlatRow[] = [];
  for (const top of doc.categories) {
    // Each top-level category is its own root; its name anchors `category`.
    rows.push(...flattenCategory(top, top.name));
  }

  const lines: string[] = [];
  lines.push(CSV_COLUMNS.map(escapeCsvField).join(','));
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((col) => escapeCsvField(row[col])).join(','),
    );
  }
  return lines.join(CSV_ROW_SEPARATOR);
}
