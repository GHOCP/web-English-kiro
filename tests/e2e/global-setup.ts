// Playwright global setup (Task 20).
//
// Runs ONCE before any spec, and before Playwright boots the `webServer` dev
// server. It makes the E2E run hermetic and deterministic by:
//
//   1. removing any leftover ephemeral database (and its sidecar journal/WAL
//      files) from a previous run;
//   2. applying the committed Prisma migrations to a fresh temp database via
//      `prisma migrate deploy` — the exact path used in production/Docker
//      startup, so the migration SQL (incl. the FTS5 virtual table + triggers)
//      is exercised here too;
//   3. seeding the known dataset (see seed.ts).
//
// The database path (`E2E_DB_URL`) is shared with the Playwright config, which
// passes the SAME `DATABASE_URL` to the dev server through `webServer.env`, so
// the running app reads exactly the database this setup just seeded.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { E2E_DB_FILE, E2E_DB_URL } from './db-path';
import { seedE2eDatabase } from './seed';

/** Remove the ephemeral DB file and any SQLite sidecar files. */
function removeDatabaseFiles(): void {
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    rmSync(`${E2E_DB_FILE}${suffix}`, { force: true });
  }
}

export default async function globalSetup(): Promise<void> {
  // 1. Start from a clean slate.
  removeDatabaseFiles();

  // 2. Apply migrations to the fresh ephemeral database.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: E2E_DB_URL },
    stdio: 'pipe',
  });

  // 3. Seed the known dataset.
  const prisma = new PrismaClient({
    datasources: { db: { url: E2E_DB_URL } },
  });
  try {
    await seedE2eDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
