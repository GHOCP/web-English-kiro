// HTML → Markdown conversion helpers for the migration pipeline (R7.2).
//
// The legacy site stores lexical content inside table cells / list items with
// inline formatting: `<br>` line breaks, `<b>`/`<strong>` bold, `<i>`/`<em>`
// italic, and numbered senses ("1. ... 2. ..."). These helpers convert that
// inline HTML into the Markdown `text` fields the rest of the system stores
// (design Q6 + Q13), and extract a leading pronunciation (`/.../`) out of a
// meaning cell (R7.2).
//
// Everything here is pure and DOM-node-driven (no DB, no filesystem), so the
// golden-file parser tests can exercise it directly.
//
// Requirements: 7.2, 7.5
import { NodeType } from 'node-html-parser';
import type { HTMLElement as HtmlElement, Node as HtmlNode } from 'node-html-parser';

/**
 * Walk a list of DOM child nodes and produce inline Markdown:
 *   - text nodes        → their decoded text (internal whitespace collapsed)
 *   - `<br>`            → a newline
 *   - `<b>` / `<strong>`→ `**bold**`
 *   - `<i>` / `<em>`    → `*italic*`
 *   - `<img>`           → dropped (genre images are extracted separately)
 *   - any other element → its children inlined (formatting flattened)
 *
 * The result is "raw" Markdown that still needs {@link cleanMarkdown} to trim
 * lines and collapse blank runs.
 */
export function inlineMarkdown(nodes: HtmlNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.nodeType === NodeType.TEXT_NODE) {
      // Collapse all whitespace (incl. NBSP + newlines) to single spaces; the
      // only hard line breaks come from explicit <br> elements below.
      out += node.text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ');
      continue;
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) continue; // skip comments

    const tag = (node.rawTagName ?? '').toLowerCase();
    switch (tag) {
      case 'br':
        out += '\n';
        break;
      case 'b':
      case 'strong': {
        const inner = inlineMarkdown(node.childNodes).trim();
        if (inner) out += `**${inner}**`;
        break;
      }
      case 'i':
      case 'em': {
        const inner = inlineMarkdown(node.childNodes).trim();
        if (inner) out += `*${inner}*`;
        break;
      }
      case 'img':
        // Images are handled by the genre parser (separate <td>), never inlined.
        break;
      default:
        out += inlineMarkdown(node.childNodes);
        break;
    }
  }
  return out;
}

/**
 * Normalize raw inline Markdown: trim each line, collapse internal whitespace
 * runs to single spaces, drop empty lines (so `<br><br>` and indentation
 * noise disappear), and trim the whole string. Numbered senses separated by a
 * single `<br>` survive as newline-separated lines.
 */
export function cleanMarkdown(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

/** Convert a cell/element's inline HTML content into cleaned Markdown. */
export function cellToMarkdown(element: HtmlElement): string {
  return cleanMarkdown(inlineMarkdown(element.childNodes));
}

/**
 * Extract a cell/element's content as a single line of plain text (used for
 * the `word` column): decode entities, collapse all whitespace, trim. NBSP-only
 * or empty cells become an empty string (callers skip those).
 */
export function cellToPlainText(element: HtmlElement): string {
  return element.text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Result of splitting a meaning cell into pronunciation + remaining text. */
export interface PronunciationSplit {
  pronunciation: string | null;
  text: string;
}

// One or more consecutive `/.../`-delimited phonetic spellings at the very
// start of the meaning (e.g. `/ˈspɪnɪtʃ,ˈspɪnɪdʒ/` or `/ˈoʊbərʒiːn/ /ˈeɡplænt/`).
// The inner part may contain anything except a slash or newline.
const LEADING_PRONUNCIATION = /^\s*((?:\/[^/\n]+\/\s*)+)/;

/**
 * Pull a leading pronunciation token out of a meaning's Markdown (R7.2). When
 * the text begins with one or more `/.../` spellings they are returned as
 * `pronunciation` (whitespace-collapsed) and stripped from `text`. When there
 * is no leading pronunciation, `pronunciation` is `null` and `text` is the
 * input unchanged.
 */
export function extractPronunciation(markdown: string): PronunciationSplit {
  const match = markdown.match(LEADING_PRONUNCIATION);
  if (!match) {
    return { pronunciation: null, text: markdown };
  }
  const pronunciation = match[1].replace(/\s+/g, ' ').trim();
  const text = markdown.slice(match[0].length).replace(/^\s+/, '');
  return { pronunciation, text };
}
