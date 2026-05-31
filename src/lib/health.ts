// Database liveness check for the health endpoint (Task 12).
//
// The check is factored out of the route handler so it can be unit-tested
// against both a healthy database (the test DB harness) and a simulated
// unhealthy one (a client whose query throws) without needing a genuinely
// broken connection. The route handler (`src/app/api/health/route.ts`) wires
// the production Prisma singleton into `getHealth`, while tests inject a
// prisma-like client.
//
// Requirements: 12.5 (health check endpoint for container orchestration).
import type { PrismaClient } from '@prisma/client';
import type { HealthResponse } from '@/types';

/**
 * The minimal slice of the Prisma client this module depends on. Typing the
 * parameter as `Pick<PrismaClient, '$queryRaw'>` keeps the real client
 * type-compatible while letting tests pass a lightweight stub.
 */
export type DbLivenessClient = Pick<PrismaClient, '$queryRaw'>;

/** HTTP body + status produced by a health check. */
export interface HealthCheckResult {
  body: HealthResponse;
  status: number;
}

/**
 * Run a lightweight `SELECT 1` against the database to confirm the connection
 * is alive. Returns `true` on success and `false` if the query throws for any
 * reason (connection down, file missing, migration not applied, etc.).
 */
export async function checkDatabaseLiveness(client: DbLivenessClient): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the health response. Returns 200 / `{ status: 'ok', database: 'up' }`
 * when the database connection is alive, and 503 / `{ status: 'error',
 * database: 'down' }` otherwise so orchestrators treat the container as
 * unhealthy.
 */
export async function getHealth(client: DbLivenessClient): Promise<HealthCheckResult> {
  const alive = await checkDatabaseLiveness(client);
  return alive
    ? { body: { status: 'ok', database: 'up' }, status: 200 }
    : { body: { status: 'error', database: 'down' }, status: 503 };
}
