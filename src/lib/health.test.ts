import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '@/test/testDb';
import { checkDatabaseLiveness, getHealth, type DbLivenessClient } from './health';

/**
 * Unit tests for the health-check logic (Task 12).
 *
 * Covers both the healthy path (real, migrated SQLite via the test DB harness)
 * and the unhealthy path (a prisma-like client whose `$queryRaw` throws),
 * verifying the status code + body contract used by the route handler and the
 * Docker health check.
 *
 * Requirements: 12.5
 */

/** A stub whose `$queryRaw` always rejects, simulating a downed connection. */
const brokenClient: DbLivenessClient = {
  $queryRaw: (() =>
    Promise.reject(new Error('connection refused'))) as PrismaClient['$queryRaw'],
};

describe('health — healthy database', () => {
  let db: TestDb;

  beforeAll(() => {
    db = createTestDb();
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  it('reports the database as alive', async () => {
    expect(await checkDatabaseLiveness(db.prisma)).toBe(true);
  });

  it('returns 200 with { status: ok, database: up }', async () => {
    const result = await getHealth(db.prisma);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: 'ok', database: 'up' });
  });
});

describe('health — unhealthy database', () => {
  it('reports the database as down when the query throws', async () => {
    expect(await checkDatabaseLiveness(brokenClient)).toBe(false);
  });

  it('returns 503 with { status: error, database: down }', async () => {
    const result = await getHealth(brokenClient);
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ status: 'error', database: 'down' });
  });
});
