// Legacy HTML → import-JSON parser (R7.1, R7.2, R7.5).
//
// Detects the three heterogeneous legacy table structures and converts each to
// the canonical nested `ImportDocument` (reused by the importer and the
// export/import round-trip):
//
//   - thesaurus (index02): <h1> part-of-speech, <h2> semantic label,
//       4-column tables grouped as (word | meaning) pairs
//       → Category(viewType=thesaurus, partOfSpeech) → Category(label)
//         → Entry + Definition (pronunciation extracted from the meaning)
//   - genre (index03): <h1> genre, <h2> subsection,
//       6-column tables grouped as (word | meaning | image) triples
//       → Category(viewType=genre) → Entry + Definition + Image(sourcePath)
//   - look-around (index04): <h1> topic, mixed <ul>/<table>/<p>
//       → Category → Entry + Definition, standalone prose preserved as notes
//
// Empty placeholder rows/cells are skipped, and duplicate (word) collisions
// within the same category are merged (their meanings appended as extra
// definitions) so the importer never trips the @@unique([word, categoryId])
// constraint. Non-fatal observations are returned as `warnings`.
//
// Pure + DOM-driven (no DB, no filesystem) so the golden-file parser tests can
// call it directly.
//
// Requirements: 7.1, 7.2, 7.3, 7.5
import { parse, NodeType } from 'node-html-parser';
import type { HTMLElement as HtmlElement } from 'node-html-parser';
import type { CategoryPartOfSpeech } from '@/types';
import {
  cellToMarkdown,
  cellToPlainText,
  cleanMarkdown,
  extractPronunciation,
  inlineMarkdown,
} from './markdown';
import type {
  ImportCategory,
  ImportDocument,
  ImportEntry,
  ImportImage,
  PageType,
  ParsePageOptions,
  ParseResult,
} from './types';

const EXPORT_VERSION = 1;

// ---------------------------------------------------------------------------
// Heading / part-of-speech helpers
// ---------------------------------------------------------------------------

// Leading decorative glyphs used as section markers in the legacy pages:
// circled/enclosed numbers and dingbats (e.g. ❶ ➊ ✪). Stripped from headings.
const LEADING_DECORATION =
  /^[\s\u2460-\u24FF\u2776-\u2793\u2700-\u27BF\u2780-\u2793\uFE0E\uFE0F]+/;

/** Clean a heading: strip leading decorative markers, collapse whitespace. */
export function cleanHeading(raw: string): string {
  return raw
    .replace(/\u00A0/g, ' ')
    .replace(LEADING_DECORATION, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map a thesaurus `<h1>` heading (e.g. "V.", "N.", "ADJ.", "Collection") to a
 * `partOfSpeech` code, or `null` when it does not match a known group.
 */
export function mapPartOfSpeech(heading: string): CategoryPartOfSpeech | null {
  const normalized = cleanHeading(heading).replace(/\.+$/, '').trim().toUpperCase();
  switch (normalized) {
    case 'V':
      return 'V';
    case 'N':
      return 'N';
    case 'ADJ':
      return 'ADJ';
    case 'COLLECTION':
      return 'Collection';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

/**
 * Locate the element whose children hold the page's content (headings, tables,
 * lists). Prefers the explicit `<div id="content">` / `<article>` wrappers used
 * by the well-formed pages. When neither exists (some legacy pages have
 * malformed markup that collapses the wrappers), fall back to the element that
 * directly contains the most content headings/tables — skipping `nav`/`aside`.
 */
function getContentRoot(root: HtmlElement): HtmlElement {
  const explicit = root.querySelector('#content') ?? root.querySelector('article');
  if (explicit) return explicit;

  // Fallback: find the parent that directly holds the most h1/h2/table nodes.
  const candidates = new Map<HtmlElement, number>();
  for (const el of root.querySelectorAll('h1, h2, table')) {
    const parent = el.parentNode;
    if (!parent) continue;
    candidates.set(parent, (candidates.get(parent) ?? 0) + 1);
  }
  let best: HtmlElement | null = null;
  let bestCount = -1;
  for (const [parent, count] of candidates) {
    if (count > bestCount) {
      best = parent;
      bestCount = count;
    }
  }
  return best ?? root;
}

/** Element children of a node, in document order (text/comment nodes dropped). */
function elementChildren(el: HtmlElement): HtmlElement[] {
  return el.childNodes.filter(
    (n): n is HtmlElement => n.nodeType === NodeType.ELEMENT_NODE,
  );
}

/** Data rows of a table: every `<tr>` that has at least one `<td>`. */
function tableDataRows(table: HtmlElement): HtmlElement[][] {
  return table
    .querySelectorAll('tr')
    .map((tr) => tr.querySelectorAll('td'))
    .filter((tds) => tds.length > 0);
}

// ---------------------------------------------------------------------------
// Builders (mutable while parsing, emitted as ImportCategory)
// ---------------------------------------------------------------------------

interface EntryBuilder {
  word: string;
  pronunciation: string | null;
  notes: string | null;
  entryType: string;
  definitions: { text: string }[];
  examples: { text: string }[];
  images: ImportImage[];
}

interface CategoryBuilder {
  name: string;
  viewType: string;
  partOfSpeech: CategoryPartOfSpeech | null;
  children: CategoryBuilder[];
  entries: EntryBuilder[];
  /** word → entry, for duplicate merging within this category. */
  byWord: Map<string, EntryBuilder>;
}

function newCategory(
  name: string,
  viewType: string,
  partOfSpeech: CategoryPartOfSpeech | null = null,
): CategoryBuilder {
  return {
    name,
    viewType,
    partOfSpeech,
    children: [],
    entries: [],
    byWord: new Map(),
  };
}

/**
 * Add a word/meaning to a category, merging into an existing entry when the
 * same word recurs (its meaning becomes an additional definition). Returns the
 * entry so callers can attach images/examples. Empty meanings are not stored
 * as definitions. Returns `null` only when `word` is empty.
 */
function upsertEntry(
  category: CategoryBuilder,
  word: string,
  meaningMarkdown: string,
  warnings: string[],
  entryType = 'word',
): EntryBuilder | null {
  const trimmedWord = word.trim();
  if (!trimmedWord) return null;

  const { pronunciation, text } = extractPronunciation(meaningMarkdown);
  const definitionText = text.trim();

  const existing = category.byWord.get(trimmedWord);
  if (existing) {
    if (definitionText) existing.definitions.push({ text: definitionText });
    if (!existing.pronunciation && pronunciation) {
      existing.pronunciation = pronunciation;
    }
    warnings.push(
      `Merged duplicate word "${trimmedWord}" in category "${category.name}".`,
    );
    return existing;
  }

  const entry: EntryBuilder = {
    word: trimmedWord,
    pronunciation,
    notes: null,
    entryType,
    definitions: definitionText ? [{ text: definitionText }] : [],
    examples: [],
    images: [],
  };
  category.entries.push(entry);
  category.byWord.set(trimmedWord, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Emit: CategoryBuilder tree → ImportCategory tree (assigns displayOrder)
// ---------------------------------------------------------------------------

function emitEntry(entry: EntryBuilder, displayOrder: number): ImportEntry {
  return {
    word: entry.word,
    pronunciation: entry.pronunciation,
    entryType: entry.entryType,
    notes: entry.notes,
    displayOrder,
    definitions: entry.definitions.map((d, i) => ({
      text: d.text,
      partOfSpeech: null,
      displayOrder: i,
    })),
    examples: entry.examples.map((e, i) => ({ text: e.text, displayOrder: i })),
    images: entry.images,
  };
}

function emitCategory(cat: CategoryBuilder, displayOrder: number): ImportCategory {
  return {
    name: cat.name,
    displayOrder,
    viewType: cat.viewType,
    partOfSpeech: cat.partOfSpeech,
    entries: cat.entries.map((e, i) => emitEntry(e, i)),
    children: cat.children.map((c, i) => emitCategory(c, i)),
  };
}

// ---------------------------------------------------------------------------
// Thesaurus parser (index02)
// ---------------------------------------------------------------------------

function parseThesaurus(
  content: HtmlElement,
  options: ParsePageOptions,
  warnings: string[],
): ImportCategory {
  const root = newCategory(options.categoryName, 'thesaurus');

  let posCategory: CategoryBuilder | null = null;
  let labelCategory: CategoryBuilder | null = null;

  for (const el of elementChildren(content)) {
    const tag = el.rawTagName.toLowerCase();
    if (tag === 'h1') {
      const heading = cleanHeading(el.text);
      if (!heading) continue;
      posCategory = newCategory(heading, 'thesaurus', mapPartOfSpeech(heading));
      root.children.push(posCategory);
      labelCategory = null;
    } else if (tag === 'h2') {
      const heading = cleanHeading(el.text);
      if (!posCategory) {
        // A label with no preceding part-of-speech: synthesize a container.
        posCategory = newCategory(options.categoryName, 'thesaurus');
        root.children.push(posCategory);
      }
      labelCategory = newCategory(heading || 'Untitled', 'thesaurus');
      posCategory.children.push(labelCategory);
    } else if (tag === 'table') {
      const target = labelCategory ?? posCategory;
      if (!target) {
        warnings.push('Thesaurus table found before any heading; skipped.');
        continue;
      }
      // 4-column layout: (word | meaning) pairs. Walk cells two at a time.
      for (const cells of tableDataRows(el)) {
        for (let i = 0; i + 1 < cells.length; i += 2) {
          const word = cellToPlainText(cells[i]);
          const meaning = cellToMarkdown(cells[i + 1]);
          if (!word) continue; // skip empty placeholder cell-pairs
          upsertEntry(target, word, meaning, warnings);
        }
      }
    }
  }

  return emitCategory(root, options.displayOrder ?? 0);
}

// ---------------------------------------------------------------------------
// Genre parser (index03)
// ---------------------------------------------------------------------------

/** Read an `<img>`'s source; returns null for empty/placeholder `img/` paths. */
function readImageSource(imgCell: HtmlElement): { src: string; alt: string } | null {
  const img = imgCell.querySelector('img');
  if (!img) return null;
  const src = (img.getAttribute('src') ?? '').trim();
  // Placeholder cells in the source look like img/, img/.jpg, etc.
  if (!src) return null;
  const base = src.split('/').pop() ?? '';
  if (base === '' || base.startsWith('.')) return null;
  return { src, alt: (img.getAttribute('alt') ?? '').trim() };
}

function makeImportImage(src: string, alt: string): ImportImage {
  const base = src.split('/').pop() ?? src;
  return {
    // Real filenames are assigned by the importer after Sharp processing; until
    // then we carry the source basename + the sourcePath used to copy the file.
    filename: base,
    thumbnailFilename: '',
    altText: alt || null,
    fileSize: 0,
    sourcePath: src,
  };
}

function parseGenre(
  content: HtmlElement,
  options: ParsePageOptions,
  warnings: string[],
): ImportCategory {
  const root = newCategory(options.categoryName, 'genre');

  let genreCategory: CategoryBuilder | null = null;
  let subCategory: CategoryBuilder | null = null;

  for (const el of elementChildren(content)) {
    const tag = el.rawTagName.toLowerCase();
    if (tag === 'h1') {
      const heading = cleanHeading(el.text);
      if (!heading) continue;
      genreCategory = newCategory(heading, 'genre');
      root.children.push(genreCategory);
      subCategory = null;
    } else if (tag === 'h2') {
      const heading = cleanHeading(el.text);
      if (!genreCategory) {
        genreCategory = newCategory(options.categoryName, 'genre');
        root.children.push(genreCategory);
      }
      subCategory = newCategory(heading || 'Untitled', 'genre');
      genreCategory.children.push(subCategory);
    } else if (tag === 'table') {
      const target = subCategory ?? genreCategory;
      if (!target) {
        warnings.push('Genre table found before any heading; skipped.');
        continue;
      }
      // 6-column layout: (word | meaning | image) triples.
      for (const cells of tableDataRows(el)) {
        for (let i = 0; i + 1 < cells.length; i += 3) {
          const word = cellToPlainText(cells[i]);
          const meaning = cellToMarkdown(cells[i + 1]);
          const imgCell = cells[i + 2];
          if (!word) continue; // skip empty placeholder triples
          const entry = upsertEntry(target, word, meaning, warnings);
          if (entry && imgCell) {
            const source = readImageSource(imgCell);
            if (source) entry.images.push(makeImportImage(source.src, source.alt));
          }
        }
      }
    }
  }

  return emitCategory(root, options.displayOrder ?? 0);
}

// ---------------------------------------------------------------------------
// Columnar word-list parser (A~Z vocabulary, phrase lists, speaking dialogues)
// ---------------------------------------------------------------------------

/**
 * Parse the large family of legacy pages laid out as `<h1>` (and optional
 * `<h2>`) section headings followed by multi-column tables whose cells repeat a
 * `word | meaning` pair (the source packs 2–3 pairs per `<tr>` to fit the page
 * width). This covers:
 *
 *   - the A~Z vocabulary (`index.html`), 6-column tables, three pairs per row;
 *   - the writing phrase lists (index07–12, 14–16, 18–20), same shape;
 *   - the speaking dialogue pages (index05–06), 4-column tables, two
 *     `dialogue | translation` pairs per row.
 *
 * Unlike the look-around parser (which reads only the first columns of a row),
 * this walks EVERY pair so nothing is dropped. `<h1>` becomes a child category
 * of the page, `<h2>` a grandchild; entries live in the deepest heading seen.
 * `viewType` is applied to the page and all its sub-categories so the UI picks
 * the right view (`list` for vocabulary/writing, `speaking` for dialogues).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.5, 13.x, 14.x
 */
function parseColumnarList(
  content: HtmlElement,
  options: ParsePageOptions,
  warnings: string[],
  viewType: string,
  wordAsMarkdown = false,
): ImportCategory {
  const root = newCategory(options.categoryName, viewType);

  let section: CategoryBuilder | null = null;
  let sub: CategoryBuilder | null = null;

  // The word column is a single term for vocabulary/phrase pages (plain text),
  // but a multi-line dialogue for speaking pages where <br> turn breaks must be
  // preserved as newlines for the speaking view to split into turns.
  const readWord = (cell: HtmlElement): string =>
    wordAsMarkdown ? cellToMarkdown(cell) : cellToPlainText(cell);

  const ensureSection = (): CategoryBuilder => {
    if (!section) {
      section = newCategory(options.categoryName, viewType);
      root.children.push(section);
    }
    return section;
  };

  for (const el of elementChildren(content)) {
    const tag = el.rawTagName.toLowerCase();
    if (tag === 'h1') {
      const heading = cleanHeading(el.text);
      if (!heading) continue;
      section = newCategory(heading, viewType);
      root.children.push(section);
      sub = null;
    } else if (tag === 'h2') {
      const heading = cleanHeading(el.text);
      if (!heading) continue;
      sub = newCategory(heading, viewType);
      ensureSection().children.push(sub);
    } else if (tag === 'table') {
      const target = sub ?? ensureSection();
      // Cells repeat (word | meaning); walk two at a time so every pair in the
      // row is captured, not just the first.
      for (const cells of tableDataRows(el)) {
        for (let i = 0; i + 1 < cells.length; i += 2) {
          const word = readWord(cells[i]);
          if (!word) continue; // skip empty placeholder pairs
          const meaning = cellToMarkdown(cells[i + 1]);
          upsertEntry(target, word, meaning, warnings);
        }
      }
    }
  }

  return emitCategory(root, options.displayOrder ?? 0);
}

// ---------------------------------------------------------------------------
// Phrase-grid parser (index17 topics) — h1 group / h2 topic / ul.grid items
// ---------------------------------------------------------------------------

/**
 * Parse the topics page (index17), whose entries live in `<ul class="grid">`
 * lists rather than tables. Each `<li>` holds:
 *   - `div.title > h2` — the phrase/pattern text (may use `<br>` for multiple
 *     related patterns), which becomes the entry `word`;
 *   - `div.title > div.num` — a decorative counter, IGNORED;
 *   - `<p>` — the illustrative sentence, stored as the entry's example.
 *
 * Headings nest as `<h1>` group → `<h2>` topic sub-category. Empty placeholder
 * items (no phrase and no sentence) are skipped. `viewType="writing"` so the
 * page renders in the writing view alongside the other expression pages.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.5, 13.x
 */
function parsePhraseGrid(
  content: HtmlElement,
  options: ParsePageOptions,
  warnings: string[],
  viewType: string,
): ImportCategory {
  const root = newCategory(options.categoryName, viewType);

  let group: CategoryBuilder | null = null;
  let topic: CategoryBuilder | null = null;

  const ensureTopic = (): CategoryBuilder => {
    if (topic) return topic;
    if (!group) {
      group = newCategory(options.categoryName, viewType);
      root.children.push(group);
    }
    topic = newCategory(options.categoryName, viewType);
    group.children.push(topic);
    return topic;
  };

  for (const el of elementChildren(content)) {
    const tag = el.rawTagName.toLowerCase();
    if (tag === 'h1') {
      const heading = cleanHeading(el.text);
      if (!heading) continue;
      group = newCategory(heading, viewType);
      root.children.push(group);
      topic = null;
    } else if (tag === 'h2') {
      const heading = cleanHeading(el.text);
      if (!heading) continue;
      if (!group) {
        group = newCategory(options.categoryName, viewType);
        root.children.push(group);
      }
      topic = newCategory(heading, viewType);
      group.children.push(topic);
    } else if (tag === 'ul') {
      const target = ensureTopic();
      for (const li of el.querySelectorAll('li')) {
        if (li.closest('li') !== li) continue; // top-level items only
        const titleEl = li.querySelector('.title h2');
        const phrase = titleEl ? cellToMarkdown(titleEl) : '';
        const sentence = li.querySelector('p');
        const example = sentence ? cellToMarkdown(sentence) : '';
        if (!phrase && !example) continue; // skip empty placeholder cells
        // Use the phrase as the word; fall back to the sentence when a grid
        // item has only a sentence. Duplicate phrases merge as usual.
        const word = phrase || example;
        const entry = upsertEntry(target, word, '', warnings, 'expression');
        if (entry && example && phrase) {
          entry.examples.push({ text: example });
        }
      }
    }
  }

  return emitCategory(root, options.displayOrder ?? 0);
}

// ---------------------------------------------------------------------------
// Look-around parser (index04) — mixed ul/table/p
// ---------------------------------------------------------------------------

/** Split a look-around `<li>` into its leading word and optional description. */
function parseDescriptionListItem(
  li: HtmlElement,
): { word: string; definition: string } {
  const description = li.querySelector('.description');
  if (!description) {
    return { word: cellToPlainText(li), definition: '' };
  }
  // Word = li's inline content excluding the description block.
  const wordNodes = li.childNodes.filter((n) => n !== description);
  const word = cleanMarkdown(inlineMarkdown(wordNodes))
    .replace(/\s+/g, ' ')
    .trim();
  const definition = cellToMarkdown(description);
  return { word, definition };
}

function parseLookAround(
  content: HtmlElement,
  options: ParsePageOptions,
  warnings: string[],
): ImportCategory {
  const root = newCategory(options.categoryName, 'list');

  let topic: CategoryBuilder | null = null;
  let prose: string[] = [];

  const flushProse = () => {
    if (topic && prose.length > 0) {
      const text = prose.join('\n\n').trim();
      if (text) {
        // Preserve standalone explanatory prose as notes on a topic entry.
        const entry = upsertEntry(topic, topic.name, '', warnings);
        if (entry) entry.notes = entry.notes ? `${entry.notes}\n\n${text}` : text;
      }
    }
    prose = [];
  };

  const ensureTopic = (): CategoryBuilder => {
    if (!topic) {
      topic = newCategory(options.categoryName, 'list');
      root.children.push(topic);
    }
    return topic;
  };

  for (const el of elementChildren(content)) {
    const tag = el.rawTagName.toLowerCase();
    if (tag === 'h1') {
      flushProse();
      const heading = cleanHeading(el.text);
      topic = newCategory(heading || 'Untitled', 'list');
      root.children.push(topic);
    } else if (tag === 'h2') {
      // Treat as additional context appended to the current topic's prose.
      const heading = cleanHeading(el.text);
      if (heading) prose.push(`**${heading}**`);
    } else if (tag === 'ul') {
      const target = ensureTopic();
      for (const li of el.querySelectorAll('li')) {
        // Only handle top-level list items (skip nested <li> re-selection).
        if (li.closest('li') !== li) continue;
        const { word, definition } = parseDescriptionListItem(li);
        if (word) upsertEntry(target, word, definition, warnings);
      }
    } else if (tag === 'table') {
      const target = ensureTopic();
      for (const cells of tableDataRows(el)) {
        if (cells.length === 0) continue;
        const word = cellToPlainText(cells[0]);
        if (!word) continue;
        const meaning = cells[1] ? cellToMarkdown(cells[1]) : '';
        const entry = upsertEntry(target, word, meaning, warnings);
        // A third populated column is treated as an example sentence.
        if (entry && cells[2]) {
          const example = cellToMarkdown(cells[2]);
          if (example) entry.examples.push({ text: example });
        }
      }
    } else if (tag === 'p') {
      const text = cellToMarkdown(el);
      if (text) prose.push(text);
    }
  }
  flushProse();

  return emitCategory(root, options.displayOrder ?? 0);
}

// ---------------------------------------------------------------------------
// Page-type detection + public API
// ---------------------------------------------------------------------------

/**
 * Heuristically detect a legacy page's type from its parsed content:
 *   - any `<td class="td-IMG">` / table image  → genre
 *   - an `<h1>` matching a part-of-speech group → thesaurus
 *   - otherwise                                 → look-around
 */
export function detectPageType(content: HtmlElement): PageType {
  if (content.querySelector('td.td-IMG') || content.querySelector('table img')) {
    return 'genre';
  }
  for (const h1 of content.querySelectorAll('h1')) {
    if (mapPartOfSpeech(h1.text)) return 'thesaurus';
  }
  return 'look-around';
}

/**
 * Parse a single legacy HTML page into an {@link ImportDocument} (one
 * top-level category for the page) plus any non-fatal warnings.
 */
export function parsePage(html: string, options: ParsePageOptions): ParseResult {
  // `fixNestedATags` repairs the legacy pages' unclosed <a> tags (which
  // otherwise collapse the <article>/#content wrapper and flatten the tree).
  const root = parse(html, { comment: false, fixNestedATags: true });
  const content = getContentRoot(root);
  const warnings: string[] = [];

  const pageType = options.pageType ?? detectPageType(content);

  let category: ImportCategory;
  switch (pageType) {
    case 'thesaurus':
      category = parseThesaurus(content, options, warnings);
      break;
    case 'genre':
      category = parseGenre(content, options, warnings);
      break;
    case 'look-around':
      category = parseLookAround(content, options, warnings);
      break;
    case 'word-list':
      category = parseColumnarList(
        content,
        options,
        warnings,
        options.viewType ?? 'list',
      );
      break;
    case 'speaking':
      category = parseColumnarList(
        content,
        options,
        warnings,
        options.viewType ?? 'speaking',
        true, // preserve <br> turn breaks in the dialogue (word) column
      );
      break;
    case 'phrase-grid':
      category = parsePhraseGrid(
        content,
        options,
        warnings,
        options.viewType ?? 'writing',
      );
      break;
    default: {
      const _never: never = pageType;
      throw new Error(`Unknown page type: ${String(_never)}`);
    }
  }

  const document: ImportDocument = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    categories: [category],
  };

  return { document, warnings };
}
