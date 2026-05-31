import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '@/test/testDb';

/**
 * GET /api/categories/:id route-handler tests (Task 19).
 *
 * The GET handler serves the `CategoryPageData` the page Server Component
 * renders, so the SWR client wrapper revalidates against an identical shape.
 * These tests import the handler and invoke it with a constructed `Request`
 * (no live server), with `@/lib/db` pointed at an isolated test database.
 *
 * Requirements: 11.1, 11.4, 5.4
 */

let db: TestDb;
let prisma: PrismaClient;
let route: typeof import('./route');

beforeAll(async () => {
  db = createTestDb();
  prisma = db.prisma;
  vi.doMock('@/lib/db', () => ({ prisma, default: prisma }));
  route = await import('./route');
}, 60_000);

afterAll(async () => {
  vi.doUnmock('@/lib/db');
  await db.cleanup();
});

afterEach(async () => {
  await prisma.entry.deleteMany();
  await prisma.category.deleteMany();
});

function getRequest(id: string): Request {
  return new Request(`http://localhost/api/categories/${id}`);
}

describe('GET /api/categories/:id', () => {
  it('returns the category page data (subtree + grouped entries)', async () => {
    const cat = await prisma.category.create({
      data: { name: 'Verbs', viewType: 'thesaurus', partOfSpeech: 'V' },
    });
    await prisma.entry.create({ data: { word: 'provoke', categoryId: cat.id } });

    const res = await route.GET(getRequest(String(cat.id)), {
      params: { id: String(cat.id) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewType).toBe('thesaurus');
    expect(body.category.id).toBe(cat.id);
    expect(body.entriesByCategory[cat.id][0].word).toBe('provoke');
  });

  it('returns 404 for a missing category', async () => {
    const res = await route.GET(getRequest('99999'), {
      params: { id: '99999' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid id', async () => {
    const res = await route.GET(getRequest('abc'), { params: { id: 'abc' } });
    expect(res.status).toBe(400);
  });
});
