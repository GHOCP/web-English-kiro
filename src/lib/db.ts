// Prisma client singleton.
//
// Next.js dev mode hot-reloads modules on every change. Without caching, each
// reload would instantiate a brand-new PrismaClient, quickly exhausting the
// SQLite connection/handle budget and emitting the well-known
// "too many PrismaClient instances" warning. We therefore stash a single
// instance on `globalThis` in non-production environments and reuse it across
// HMR cycles. In production a fresh module graph is created once, so the global
// cache is unnecessary (and intentionally skipped).
//
// Requirements: NFR 1.1 (Next.js/React stack), NFR 1.3 (Node.js ORM — Prisma).
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
