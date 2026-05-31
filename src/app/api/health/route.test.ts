import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-handler tests for GET /api/health (Task 12).
 *
 * These verify the route correctly maps the DB liveness check onto the HTTP
 * contract (200 when up, 503 when down) by mocking the Prisma singleton's
 * `$queryRaw`, so neither a real database nor a genuinely broken one is needed.
 *
 * Requirements: 12.5
 */
describe('GET /api/health', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('marks the route as dynamic (no caching) so health is always live', async () => {
    vi.doMock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]) } }));
    const route = await import('./route');
    expect(route.dynamic).toBe('force-dynamic');
  });

  it('returns 200 and { status: ok, database: up } when the DB is alive', async () => {
    vi.doMock('@/lib/db', () => ({
      prisma: { $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]) },
    }));
    const { GET } = await import('./route');

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok', database: 'up' });
  });

  it('returns 503 and { status: error, database: down } when the DB query throws', async () => {
    vi.doMock('@/lib/db', () => ({
      prisma: { $queryRaw: vi.fn().mockRejectedValue(new Error('db down')) },
    }));
    const { GET } = await import('./route');

    const res = await GET();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ status: 'error', database: 'down' });
  });
});
