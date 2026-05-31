// Playwright global teardown (Task 20).
//
// Removes the ephemeral E2E database created by global-setup.ts so the run
// leaves no artifacts behind. Best-effort: failures here must not fail the run.
import { rmSync } from 'node:fs';
import { E2E_DB_FILE } from './db-path';

export default async function globalTeardown(): Promise<void> {
  for (const suffix of ['', '-journal', '-shm', '-wal']) {
    rmSync(`${E2E_DB_FILE}${suffix}`, { force: true });
  }
}
