import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestDb, type TestDb } from '@/test/testDb';

/**
 * Category API route-handler tests (Task 7).
 *
 * These import the App Router route handlers and invoke them with standard
 * `Request` objects (no live server). The `@/lib/db` singleton is replaced with
 * an isolated, fully-migrated test database via `vi.doMock` before the handlers
 * are dynamically imported, so the handlers run their real logic end-to-end
 * while staying hermetic.
 *
 * Focus: HTTP glue — status codes, validation responses, and CategoryError →
 * response mapping (the underlying behaviour is covered in categories.test.ts).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 9.1, 9.4
 */

let db: TestDb;
let prisma: PrismaClient;

// Route handler modules (loaded after the db mock is registered).
let collectionRoute: typeof import('./route');
let itemRoute: typeof import('./[id]/route');

beforeAll(async () => {
  db = createTestDb();
  prisma = db.prisma;

  vi.doMock('@/lib/db', () => ({ prisma, default: prisma }));

  collectionRoute = await import('./route');
  itemRoute = await import('./[id]/route');
}, 60_000);

afterAll(async () => {
  vi.doUnmock('@/lib/db');
  await db.cleanup();
});

afterEach(async () => {
  await prisma.entry.deleteMany();
  await prisma.category.deleteMany();
});

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/categories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/categories/1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteRequest(body: unknown): Request {
  return new Request('http://localhost/api/categories/1', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/categories', () => {
  it('returns the nested tree', async () => {
    const root = await prisma.category.create({ data: { name: 'Root' } });
    await prisma.category.create({ data: { name: 'Child', parentId: root.id } });

    const res = await collectionRoute.GET();
    expect(res.status).toBe(200);
    const tree = await res.json();
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('Root');
    expect(tree[0].children[0].name).toBe('Child');
  });
});

describe('POST /api/categories', () => {
  it('creates a category and returns 201', async () => {
    const res = await collectionRoute.POST(
      postRequest({ name: 'Vocabulary', viewType: 'thesaurus', partOfSpeech: 'V' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Vocabulary');
    expect(body.viewType).toBe('thesaurus');
  });

  it('returns 400 for an invalid payload', async () => {
    const res = await collectionRoute.POST(postRequest({ name: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors[0].field).toBe('name');
  });

  it('returns 400 when the parent does not exist', async () => {
    const res = await collectionRoute.POST(
      postRequest({ name: 'Orphan', parentId: 99999 }),
    );
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/categories/:id', () => {
  it('renames a category', async () => {
    const cat = await prisma.category.create({ data: { name: 'Old' } });
    const res = await itemRoute.PATCH(patchRequest({ name: 'New' }), {
      params: { id: String(cat.id) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('New');
  });

  it('returns 400 when moving under a descendant (cycle prevention)', async () => {
    const root = await prisma.category.create({ data: { name: 'root' } });
    const child = await prisma.category.create({
      data: { name: 'child', parentId: root.id },
    });
    const res = await itemRoute.PATCH(patchRequest({ parentId: child.id }), {
      params: { id: String(root.id) },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a missing category', async () => {
    const res = await itemRoute.PATCH(patchRequest({ name: 'x' }), {
      params: { id: '99999' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid id', async () => {
    const res = await itemRoute.PATCH(patchRequest({ name: 'x' }), {
      params: { id: 'abc' },
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/categories/:id', () => {
  it('requires an explicit mode (Q18) → 400', async () => {
    const cat = await prisma.category.create({ data: { name: 'C' } });
    const res = await itemRoute.DELETE(deleteRequest({}), {
      params: { id: String(cat.id) },
    });
    expect(res.status).toBe(400);
  });

  it('cascade-deletes and returns the result', async () => {
    const cat = await prisma.category.create({ data: { name: 'C' } });
    await prisma.entry.create({ data: { word: 'w', categoryId: cat.id } });

    const res = await itemRoute.DELETE(deleteRequest({ mode: 'cascade' }), {
      params: { id: String(cat.id) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affectedEntryCount).toBe(1);
    expect(await prisma.category.count()).toBe(0);
  });

  it('reassigns entries to a target category', async () => {
    const source = await prisma.category.create({ data: { name: 'S' } });
    const target = await prisma.category.create({ data: { name: 'T' } });
    await prisma.entry.create({ data: { word: 'w', categoryId: source.id } });

    const res = await itemRoute.DELETE(
      deleteRequest({ mode: 'reassign', reassignToCategoryId: target.id }),
      { params: { id: String(source.id) } },
    );
    expect(res.status).toBe(200);
    expect(await prisma.entry.count({ where: { categoryId: target.id } })).toBe(1);
  });
});
