#!/usr/bin/env node
/**
 * migrate-html.ts — HTML → reviewable JSON extraction (R7.1, R7.3).
 *
 * Thin CLI wrapper around the tested migration library
 * (`src/lib/migration`). It reads each configured legacy page, parses it into
 * the canonical `ImportDocument`, and writes one JSON file per source page
 * under the output directory (default `data/migration/`) for the owner to
 * review before import.
 *
 * All parsing logic lives in `src/lib/migration/parse.ts` (covered by
 * golden-file tests); this file only does argument handling and file I/O.
 *
 * Usage (requires a TS runner, e.g. `npx tsx`):
 *   npx tsx scripts/migrate-html.ts [--out data/migration] [--htmls htmls]
 *
 * Requirements: 7.1, 7.2, 7.3, 7.5
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePage } from '../src/lib/migration/parse';
import type { ImportCategory, PageType } from '../src/lib/migration/types';

/** A legacy page to migrate: source file, category name, page type. */
interface PageConfig {
  /** Path to index.html relative to the htmls root (or repo root when `fromRepoRoot`). */
  file: string;
  /** Top-level category name for the page. */
  categoryName: string;
  /** Page kind (omit to auto-detect). */
  pageType?: PageType;
  /** Override the viewType stamped on the page's categories (word-list/speaking only). */
  viewType?: string;
  /** Resolve `file` against the repo root instead of the htmls root (for the A~Z page). */
  fromRepoRoot?: boolean;
  /** Output JSON filename (relative to the out dir). */
  outFile: string;
}

/**
 * The legacy pages and how they map to categories. Mirrors the design's
 * "Migration Strategy" table. Pages can be added here as they are migrated.
 */
const PAGES: PageConfig[] = [
  // --- Vocabulary ----------------------------------------------------------
  {
    // The A~Z vocabulary lives at the repository root (the nav's "A ~ Z" link),
    // not under htmls/. 6-column word|meaning tables, sections A..Z.
    file: 'index.html',
    fromRepoRoot: true,
    categoryName: 'A ~ Z',
    pageType: 'word-list',
    viewType: 'list',
    outFile: 'index01-a_to_z.json',
  },
  {
    file: 'index02-thesaurus/index.html',
    categoryName: 'Thesaurus',
    pageType: 'thesaurus',
    outFile: 'index02-thesaurus.json',
  },
  // --- Accretion -----------------------------------------------------------
  {
    file: 'index03-words_by_genres/index.html',
    categoryName: 'Words by genres',
    pageType: 'genre',
    outFile: 'index03-words_by_genres.json',
  },
  {
    file: 'index04-words_look_around/index.html',
    categoryName: 'Look-around',
    pageType: 'look-around',
    outFile: 'index04-words_look_around.json',
  },
  // --- Speaking ------------------------------------------------------------
  {
    file: 'index05-scenes/index.html',
    categoryName: 'Scenes',
    pageType: 'speaking',
    outFile: 'index05-scenes.json',
  },
  {
    file: 'index06-daily/index.html',
    categoryName: 'Daily',
    pageType: 'speaking',
    outFile: 'index06-daily.json',
  },
  // --- Writing: Phrases ----------------------------------------------------
  {
    file: 'index07-except_verb_n/index.html',
    categoryName: 'Phrases — Except Verb / N.',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index07-except_verb_n.json',
  },
  {
    file: 'index08-verb_virtual/index.html',
    categoryName: 'Phrases — Verb',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index08-verb_virtual.json',
  },
  {
    file: 'index09-noun_virtual/index.html',
    categoryName: 'Phrases — Noun',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index09-noun_virtual.json',
  },
  {
    file: 'index10-n_normal/index.html',
    categoryName: 'Phrases — N (normal)',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index10-n_normal.json',
  },
  {
    file: 'index11-v_normal/index.html',
    categoryName: 'Phrases — V (normal)',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index11-v_normal.json',
  },
  {
    file: 'index12-adj_normal/index.html',
    categoryName: 'Phrases — ADJ (normal)',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index12-adj_normal.json',
  },
  // --- Writing: Structure --------------------------------------------------
  {
    // h1 topic → h2 sub-heading → <ul> sense lists: the look-around parser
    // captures these losslessly (prose/notes preserved).
    file: 'index13-struct_normal/index.html',
    categoryName: 'Structure — Normal',
    pageType: 'look-around',
    outFile: 'index13-struct_normal.json',
  },
  {
    file: 'index14-struct_starting/index.html',
    categoryName: 'Structure — Starting',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index14-struct_starting.json',
  },
  {
    file: 'index15-struct_link_sw/index.html',
    categoryName: 'Structure — Link (single word)',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index15-struct_link_sw.json',
  },
  {
    file: 'index16-struct_link_phrases/index.html',
    categoryName: 'Structure — Link (phrases)',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index16-struct_link_phrases.json',
  },
  // --- Writing: Expressions ------------------------------------------------
  {
    // h1 group → h2 topic → ul.grid items (.title h2 = phrase, p = sentence).
    file: 'index17-topics/index.html',
    categoryName: 'Expressions — Topics',
    pageType: 'phrase-grid',
    viewType: 'writing',
    outFile: 'index17-topics.json',
  },
  {
    file: 'index18-excerpt/index.html',
    categoryName: 'Expressions — Excerpt',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index18-excerpt.json',
  },
  {
    file: 'index19-asking/index.html',
    categoryName: 'Expressions — Asking',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index19-asking.json',
  },
  {
    file: 'index20-express_normal/index.html',
    categoryName: 'Expressions — Normal',
    pageType: 'word-list',
    viewType: 'writing',
    outFile: 'index20-express_normal.json',
  },
];

function parseArgs(argv: string[]): { out: string; htmls: string } {
  let out = path.resolve('data/migration');
  let htmls = path.resolve('htmls');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' && argv[i + 1]) out = path.resolve(argv[(i += 1)]);
    else if (arg === '--htmls' && argv[i + 1]) htmls = path.resolve(argv[(i += 1)]);
  }
  return { out, htmls };
}

async function main(): Promise<void> {
  const { out, htmls } = parseArgs(process.argv.slice(2));
  const repoRoot = path.dirname(htmls);
  await mkdir(out, { recursive: true });

  let totalEntries = 0;
  for (const page of PAGES) {
    const baseDir = page.fromRepoRoot ? repoRoot : htmls;
    const sourcePath = path.join(baseDir, page.file);
    let html: string;
    try {
      html = await readFile(sourcePath, 'utf8');
    } catch {
      console.warn(`! Skipping ${page.file}: file not found at ${sourcePath}`);
      continue;
    }

    const { document, warnings } = parsePage(html, {
      categoryName: page.categoryName,
      pageType: page.pageType,
      viewType: page.viewType,
    });

    const destination = path.join(out, page.outFile);
    await writeFile(destination, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    const entryCount = countEntries(document.categories);
    totalEntries += entryCount;
    console.log(`✓ ${page.file} → ${page.outFile} (${entryCount} entries)`);
    for (const warning of warnings) console.log(`    · ${warning}`);
  }

  console.log(`\nDone. ${totalEntries} entries extracted to ${out}`);
}

/** Count entries across a category forest (for the run summary). */
function countEntries(categories: ImportCategory[]): number {
  let total = 0;
  for (const c of categories) {
    total += c.entries.length;
    total += countEntries(c.children);
  }
  return total;
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
});
