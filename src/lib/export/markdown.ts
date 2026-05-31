// Markdown export serializer (R8.4).
//
// Produces a human-readable Markdown document with one section per category.
// Nesting depth maps to heading level (top-level category → `#`, child → `##`,
// …, capped at `######`). Each entry is a formatted list item; its stored
// definition/example `text` fields are already Markdown, so this is a
// near-direct serialization (design "Export Design").
//
// Output is intentionally lossy/human-oriented (only JSON round-trips —
// Property 3). The goal is something pleasant to read in any Markdown viewer or
// text editor.
//
// Requirements: 8.4, 8.5
import type { ExportDocument, ExportedCategory, ExportedEntry } from '@/types';

const MAX_HEADING_LEVEL = 6;

/** Render a single entry as a Markdown list item with nested detail lines. */
function renderEntry(entry: ExportedEntry): string {
  const lines: string[] = [];

  // Heading line for the entry: **word** /pronunciation/
  const head = entry.pronunciation
    ? `- **${entry.word}** ${entry.pronunciation}`
    : `- **${entry.word}**`;
  lines.push(head);

  for (const def of entry.definitions) {
    // Indent under the entry bullet; preserve the stored Markdown text as-is.
    lines.push(`  - ${def.text}`);
  }

  if (entry.examples.length > 0) {
    lines.push(`  - _Examples:_`);
    for (const ex of entry.examples) {
      lines.push(`    - ${ex.text}`);
    }
  }

  if (entry.notes) {
    lines.push(`  - _Notes:_ ${entry.notes}`);
  }

  return lines.join('\n');
}

/** Recursively render a category subtree at the given heading `level`. */
function renderCategory(category: ExportedCategory, level: number): string {
  const headingLevel = Math.min(level, MAX_HEADING_LEVEL);
  const hashes = '#'.repeat(headingLevel);
  const blocks: string[] = [];

  blocks.push(`${hashes} ${category.name}`);

  if (category.entries.length > 0) {
    blocks.push(category.entries.map(renderEntry).join('\n'));
  }

  for (const child of category.children) {
    blocks.push(renderCategory(child, level + 1));
  }

  return blocks.join('\n\n');
}

/** Serialize an {@link ExportDocument} to a human-readable Markdown string. */
export function serializeMarkdown(doc: ExportDocument): string {
  if (doc.categories.length === 0) {
    return '';
  }
  return doc.categories
    .map((cat) => renderCategory(cat, 1))
    .join('\n\n');
}
