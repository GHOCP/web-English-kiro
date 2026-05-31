// Markdown sanitization + plain-text extraction utilities.
//
// Stored lexical content (definitions, examples, notes) is authored as
// Markdown. When that content is rendered to HTML it MUST be sanitized so that
// no script or other unsafe/disallowed HTML can survive — this is the core of
// our stored-XSS defense (NFR 4.1). The same sanitization contract is exercised
// by the `Markdown` component (`src/components/Markdown.tsx`).
//
// We deliberately allow only a tiny, read-only formatting subset:
//   - paragraphs            <p>
//   - line breaks           <br>
//   - bold                  <strong>, <b>
//   - italic                <em>, <i>
//   - unordered/ordered lists and items   <ul>, <ol>, <li>
// Everything else (scripts, iframes, images, anchors, raw HTML, event handler
// attributes, `javascript:` URLs, etc.) is stripped.
//
// This module also exposes `markdownToPlainText`, which flattens Markdown to a
// plain string for full-text-search indexing and result snippets (Tasks 8, 10,
// 11).
//
// Requirements: 3.2 (mixed-language Markdown definitions), 3.3 (safe rendering),
// NFR 4.1 (sanitize all user input to prevent XSS).
import type { Options as RehypeSanitizeOptions } from 'rehype-sanitize';
import { fromMarkdown } from 'mdast-util-from-markdown';

/**
 * The HTML tag names we permit in rendered Markdown. Anything outside this list
 * is removed by `rehype-sanitize`.
 */
export const ALLOWED_TAG_NAMES = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'ul',
  'ol',
  'li',
] as const;

/**
 * Restrictive `rehype-sanitize` schema.
 *
 * - `tagNames`: only the safe formatting subset above survives; every other
 *   element (script, iframe, img, a, style, svg, etc.) is dropped.
 * - `attributes`: an empty map means NO attributes are preserved on any tag.
 *   This removes `on*` event handlers, `style`, `class`, `id`, `href`/`src`
 *   (and therefore any `javascript:` URL), and all other attributes outright.
 * - `protocols`: empty — no URL-bearing attributes are allowed at all, so there
 *   is nothing for a `javascript:`/`data:` protocol to attach to.
 * - `clobberPrefix`/`clobber`: defaults retained as defense-in-depth against DOM
 *   clobbering, though with no attributes allowed they cannot be reached.
 * - `strip`: explicitly drop `<script>` and `<style>` content entirely rather
 *   than leaving their text behind.
 */
export const sanitizeSchema: RehypeSanitizeOptions = {
  tagNames: [...ALLOWED_TAG_NAMES],
  attributes: {},
  protocols: {},
  clobberPrefix: 'user-content-',
  clobber: [],
  strip: ['script', 'style'],
  allowComments: false,
  allowDoctypes: false,
};

// mdast node types that act as block-level containers. Their children are
// separated by a boundary (newline) so that, e.g., adjacent list items or
// paragraphs do not get their words concatenated ("one"+"two" -> "one two").
// Inline containers (paragraph, heading, emphasis, strong, link, …) instead
// join their children directly, because any needed spacing already lives in the
// text nodes between them.
const BLOCK_CONTAINER_TYPES = new Set<string>([
  'root',
  'list',
  'listItem',
  'blockquote',
  'table',
  'tableRow',
  'tableCell',
  'footnoteDefinition',
]);

/**
 * Recursively flatten an mdast node to readable text.
 *
 * - Leaf text nodes (`text`, `inlineCode`, `code`) contribute their value.
 * - Hard line breaks become a space.
 * - Raw HTML nodes contribute nothing (their markup is dropped, never
 *   reproduced), so embedded tags like `<script>` cannot leak into the output.
 * - Images contribute their alt text.
 * - Block containers join children with a newline boundary; everything else
 *   joins children directly.
 */
function flattenNode(node: unknown): string {
  if (node == null || typeof node !== 'object') {
    return '';
  }
  const n = node as {
    type?: string;
    value?: string;
    alt?: string | null;
    children?: unknown[];
  };

  switch (n.type) {
    case 'text':
    case 'inlineCode':
    case 'code':
      return n.value ?? '';
    case 'break':
      return ' ';
    case 'html':
      // Drop raw HTML markup entirely (defense for FTS/snippets).
      return '';
    case 'image':
      return n.alt ?? '';
    default:
      break;
  }

  if (!Array.isArray(n.children)) {
    return '';
  }

  const separator = n.type && BLOCK_CONTAINER_TYPES.has(n.type) ? '\n' : '';
  return n.children.map(flattenNode).join(separator);
}

/**
 * Convert a Markdown string into plain text suitable for FTS indexing and
 * search snippets.
 *
 * Formatting markers (`*`, `_`, `#`, list bullets, link syntax, etc.) are
 * removed, leaving only the human-readable text content. Soft line breaks and
 * block boundaries are normalized to single spaces and the result is trimmed so
 * indexed/snippet text is compact and predictable. Words from separate blocks
 * (paragraphs, list items, headings) stay separated rather than running
 * together.
 *
 * Safe for arbitrary input: malformed Markdown and embedded raw HTML are parsed
 * as text (with markup dropped) and never executed.
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) {
    return '';
  }

  // Parse to an mdast tree, then collapse to readable text with block-aware
  // separators.
  const tree = fromMarkdown(markdown);
  const text = flattenNode(tree);

  // Normalize all runs of whitespace (including the block-boundary newlines)
  // down to single spaces, then trim the ends.
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Build a single-line snippet of at most `maxLength` characters from Markdown,
 * appending an ellipsis when the source text is longer. Used for search result
 * previews (Requirement 6.3).
 */
export function markdownToSnippet(markdown: string, maxLength = 160): string {
  const text = markdownToPlainText(markdown);
  if (text.length <= maxLength) {
    return text;
  }
  // Avoid cutting mid-word where reasonable: trim back to the last space.
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(' ');
  const base = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.trimEnd()}…`;
}
