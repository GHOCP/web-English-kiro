#!/usr/bin/env node
/**
 * import-json.ts — JSON → SQLite import (R7.4, R4.5, NFR 3.2).
 *
 * Thin CLI wrapper around the tested importer (`src/lib/migration/import.ts`).
 * It reads a reviewed migration JSON file, validates it, and bulk-inserts the
 * collection in a single transaction, copying referenced source images into
 * `uploads/` with Sharp thumbnails.
 *
 * All import logic lives in `importDocument`; this file only does argument
 * handling, file reading, and Prisma client lifecycle.
 *
 * Usage (requires a TS runner, e.g. `npx tsx`):
 *   npx tsx scripts/import-json.ts <file.json> [--source-dir htmls/index03-words_by_genres] [--uploads uploads]
 *
 * Requirements: 7.4, 4.5, NFR 3.2
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { importDocument } from '../src/lib/migration/import';
import type { ImportDocument } from '../src/lib/migration/types';

interface CliArgs {
  jsonPath: string | null;
  sourceDir?: string;
  uploadsDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { jsonPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source-dir' && argv[i + 1]) args.sourceDir = path.resolve(argv[(i += 1)]);
    else if (arg === '--uploads' && argv[i + 1]) args.uploadsDir = path.resolve(argv[(i += 1)]);
    else if (!arg.startsWith('--') && !args.jsonPath) args.jsonPath = path.resolve(arg);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.jsonPath) {
    console.error('Usage: import-json.ts <file.json> [--source-dir <dir>] [--uploads <dir>]');
    process.exitCode = 1;
    return;
  }

  const raw = await readFile(args.jsonPath, 'utf8');
  const document = JSON.parse(raw) as ImportDocument;

  const prisma = new PrismaClient();
  try {
    const summary = await importDocument(prisma, document, {
      sourceDir: args.sourceDir,
      uploadsDir: args.uploadsDir,
    });
    console.log(
      `✓ Imported ${summary.categoriesCreated} categories, ${summary.entriesCreated} entries, ` +
        `${summary.definitionsCreated} definitions, ${summary.examplesCreated} examples, ` +
        `${summary.imagesCreated} images.`,
    );
    for (const warning of summary.warnings) console.log(`    · ${warning}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exitCode = 1;
});
