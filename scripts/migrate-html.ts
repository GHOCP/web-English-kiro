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
  /** Path to index.html relative to the htmls root. */
  file: string;
  /** Top-level category name for the page. */
  categoryName: string;
  /** Page kind (omit to auto-detect). */
  pageType?: PageType;
  /** Output JSON filename (relative to the out dir). */
  outFile: string;
}

/**
 * The legacy pages and how they map to categories. Mirrors the design's
 * "Migration Strategy" table. Pages can be added here as they are migrated.
 */
const PAGES: PageConfig[] = [
  {
    file: 'index02-thesaurus/index.html',
    categoryName: 'Thesaurus',
    pageType: 'thesaurus',
    outFile: 'index02-thesaurus.json',
  },
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
  await mkdir(out, { recursive: true });

  let totalEntries = 0;
  for (const page of PAGES) {
    const sourcePath = path.join(htmls, page.file);
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
