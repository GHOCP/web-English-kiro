import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Test support: create an isolated, fully-migrated SQLite database.
 *
 * Each call provisions a fresh database file in a temp directory and applies
 * the committed Prisma migrations (including the raw-SQL FTS5 virtual table and
 * sync triggers) via `prisma migrate deploy`. This exercises the real migration
 * SQL — the same path used in production/Docker startup — rather than a
 * hand-rolled schema, so the tests validate what actually ships.
 */
export interface TestDb {
  prisma: PrismaClient;
  /** Absolute `file:` URL of the database, useful for raw assertions. */
  url: string;
  /** Disconnect the client and delete the temp database directory. */
  cleanup: () => Promise<void>;
}

export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'lexical-test-'));
  const dbPath = join(dir, 'test.db');
  const url = `file:${dbPath}`;

  // Apply migrations to the isolated database. We point DATABASE_URL at the
  // temp file; an absolute path keeps Prisma from resolving relative to the
  // schema directory.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({
    datasources: { db: { url } },
  });

  return {
    prisma,
    url,
    cleanup: async () => {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
