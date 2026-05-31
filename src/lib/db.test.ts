import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Unit tests for the Prisma client singleton (Task 3).
 *
 * Verifies:
 * - A usable PrismaClient instance is exported.
 * - In non-production (dev/test) the instance is cached on globalThis so
 *   Next.js HMR reuses it instead of spawning a new client per reload
 *   (NFR 1.1, NFR 1.3).
 *
 * Requirements: NFR 1.1, NFR 1.3
 */
describe('prisma client singleton', () => {
  afterEach(() => {
    vi.resetModules();
    // Clean up any cached instance between tests for isolation.
    delete (globalThis as unknown as { prisma?: unknown }).prisma;
  });

  it('exports a PrismaClient instance', async () => {
    const { prisma } = await import('./db');
    expect(prisma).toBeInstanceOf(PrismaClient);
  });

  it('exposes the same instance as the default export', async () => {
    const mod = await import('./db');
    expect(mod.default).toBe(mod.prisma);
  });

  it('caches the instance on globalThis outside production (HMR-safe)', async () => {
    const { prisma } = await import('./db');
    expect((globalThis as unknown as { prisma?: unknown }).prisma).toBe(prisma);
  });

  it('reuses the cached global instance across module reloads', async () => {
    const first = (await import('./db')).prisma;
    vi.resetModules();
    const second = (await import('./db')).prisma;
    // The reloaded module picks up the globally-cached client rather than
    // constructing a second one (the bug this pattern prevents during dev HMR).
    expect(second).toBe(first);
  });
});
