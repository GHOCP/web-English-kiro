// @vitest-environment node
//
// These are server-side route-handler tests: they construct real multipart
// `Request`s and read `File`/`Blob` bodies. The default jsdom environment ships
// its own `FormData`/`File`/`Blob` globals that do not serialize into Node's
// undici `Request`, which hangs `request.formData()` whenever a file part is
// present. Running in the `node` environment uses Node's native, mutually
// compatible web globals.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { PrismaClient } from '@prisma/client';

import { createTestDb, type TestDb } from '@/test/testDb';
import { MAX_IMAGE_SIZE_BYTES } from '@/lib/images';

/**
 * Integration tests for the Image upload/delete/serve API (Task 9).
 *
 * Exercises the real route handlers against an isolated, fully-migrated SQLite
 * database (via the test harness) and a temp uploads directory, so uploads
 * write real files + rows and deletes remove them.
 *
 * Covers:
 *   - POST /api/images: valid upload creates row + original + thumbnail.
 *   - POST validation: oversized (400), wrong-type (400), missing/invalid
 *     entryId (400), missing file (400) — none of which leave files behind.
 *   - DELETE /api/images/:id: removes row + both files; 404 when missing.
 *   - GET /api/images/:id/file: serves original/thumbnail with the right
 *     content-type; 404 for missing; path-safety blocks a malicious filename
 *     so the DB file / arbitrary paths are never reachable (NFR 4.3).
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, NFR 4.2, NFR 4.3
 */

// The route handlers import `prisma` from `@/lib/db` (a singleton bound to the
// production DATABASE_URL). Redirect that to the per-test harness client via a
// forwarding proxy so the handlers and the test seed share one database.
const dbHolder = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
}));

vi.mock('@/lib/db', () => {
  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        const client = dbHolder.client as unknown as Record<string, unknown>;
        const value = client[prop as string];
        return typeof value === 'function' ? value.bind(client) : value;
      },
    },
  );
  return { prisma: proxy, default: proxy };
});

// Import the handlers AFTER the mock is registered.
import { POST } from './route';
import { DELETE } from './[id]/route';
import { GET } from './[id]/file/route';

let db: TestDb;
let prisma: PrismaClient;
let uploadsDir: string;
let prevUploadsDir: string | undefined;

beforeAll(() => {
  db = createTestDb();
  prisma = db.prisma;
  dbHolder.client = prisma;
}, 60_000);

afterAll(async () => {
  await db.cleanup();
});

beforeEach(() => {
  uploadsDir = mkdtempSync(path.join(tmpdir(), 'lexical-api-uploads-'));
  prevUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = uploadsDir;
});

afterEach(() => {
  if (prevUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = prevUploadsDir;
  rmSync(uploadsDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let categoryCounter = 0;

/** Create a fresh entry to attach images to (unique to avoid @@unique clashes). */
async function makeEntry(): Promise<number> {
  const category = await prisma.category.create({
    data: { name: `ImgCat-${++categoryCounter}` },
  });
  const entry = await prisma.entry.create({
    data: { word: `word-${categoryCounter}`, categoryId: category.id },
  });
  return entry.id;
}

async function makeImageBuffer(
  format: 'jpeg' | 'png' | 'webp' = 'png',
  width = 600,
  height = 400,
): Promise<Buffer> {
  const base = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 150, b: 90 },
    },
  });
  if (format === 'jpeg') return base.jpeg().toBuffer();
  if (format === 'webp') return base.webp().toBuffer();
  return base.png().toBuffer();
}

function uploadRequest(fields: {
  file?: { buffer: Buffer; filename: string; type: string };
  entryId?: string | number;
  altText?: string;
  omitFile?: boolean;
}): Request {
  const fd = new FormData();
  if (fields.file && !fields.omitFile) {
    const blob = new File([fields.file.buffer], fields.file.filename, {
      type: fields.file.type,
    });
    fd.set('file', blob);
  }
  if (fields.entryId !== undefined) fd.set('entryId', String(fields.entryId));
  if (fields.altText !== undefined) fd.set('altText', fields.altText);
  return new Request('http://localhost/api/images', {
    method: 'POST',
    body: fd,
  });
}

// ---------------------------------------------------------------------------
// POST /api/images — upload
// ---------------------------------------------------------------------------

describe('POST /api/images', () => {
  it('stores a valid image: creates the row plus original + thumbnail files', async () => {
    const entryId = await makeEntry();
    const buffer = await makeImageBuffer('png', 800, 500);

    const res = await POST(
      uploadRequest({
        file: { buffer, filename: 'photo.png', type: 'image/png' },
        entryId,
        altText: 'a green rectangle',
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeGreaterThan(0);
    expect(body.filename).toMatch(/\.png$/);
    expect(body.thumbnailFilename).toMatch(/\.thumb\.png$/);
    expect(body.altText).toBe('a green rectangle');
    expect(body.fileSize).toBe(buffer.length);

    // DB row persisted and attached to the entry.
    const row = await prisma.image.findUnique({ where: { id: body.id } });
    expect(row?.entryId).toBe(entryId);

    // Both files on disk.
    expect(existsSync(path.join(uploadsDir, body.filename))).toBe(true);
    expect(existsSync(path.join(uploadsDir, body.thumbnailFilename))).toBe(true);
  });

  it('rejects an oversized image with 400 and writes nothing', async () => {
    const entryId = await makeEntry();
    // Valid JPEG magic bytes but past the 5MB limit.
    const oversized = Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;

    const res = await POST(
      uploadRequest({
        file: { buffer: oversized, filename: 'big.jpg', type: 'image/jpeg' },
        entryId,
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors?.[0]?.field).toBe('file');
    expect(await prisma.image.count({ where: { entryId } })).toBe(0);
  });

  it('rejects a non-image (wrong type) upload with 400', async () => {
    const entryId = await makeEntry();
    const notImage = Buffer.from('this is definitely not an image');

    const res = await POST(
      uploadRequest({
        file: { buffer: notImage, filename: 'note.txt', type: 'image/png' },
        entryId,
      }),
    );

    expect(res.status).toBe(400);
    expect(await prisma.image.count({ where: { entryId } })).toBe(0);
  });

  it('rejects a spoofed MIME (declared png, bytes are jpeg) with 400', async () => {
    const entryId = await makeEntry();
    const jpeg = await makeImageBuffer('jpeg');

    const res = await POST(
      uploadRequest({
        file: { buffer: jpeg, filename: 'spoof.png', type: 'image/png' },
        entryId,
      }),
    );

    expect(res.status).toBe(400);
    expect(await prisma.image.count({ where: { entryId } })).toBe(0);
  });

  it('rejects a missing file field with 400', async () => {
    const entryId = await makeEntry();
    const res = await POST(uploadRequest({ entryId, omitFile: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors?.[0]?.field).toBe('file');
  });

  it('rejects a missing/invalid entryId with 400', async () => {
    const buffer = await makeImageBuffer('png');
    const res = await POST(
      uploadRequest({
        file: { buffer, filename: 'x.png', type: 'image/png' },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors?.[0]?.field).toBe('entryId');
  });

  it('rejects an entryId that does not exist with 400', async () => {
    const buffer = await makeImageBuffer('png');
    const res = await POST(
      uploadRequest({
        file: { buffer, filename: 'x.png', type: 'image/png' },
        entryId: 999_999,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors?.[0]?.field).toBe('entryId');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/images/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/images/:id', () => {
  it('removes the DB row and both files', async () => {
    const entryId = await makeEntry();
    const buffer = await makeImageBuffer('png');
    const uploadRes = await POST(
      uploadRequest({
        file: { buffer, filename: 'del.png', type: 'image/png' },
        entryId,
      }),
    );
    const { id, filename, thumbnailFilename } = await uploadRes.json();
    expect(existsSync(path.join(uploadsDir, filename))).toBe(true);

    const res = await DELETE(new Request('http://localhost'), {
      params: { id: String(id) },
    });

    expect(res.status).toBe(204);
    expect(await prisma.image.findUnique({ where: { id } })).toBeNull();
    expect(existsSync(path.join(uploadsDir, filename))).toBe(false);
    expect(existsSync(path.join(uploadsDir, thumbnailFilename))).toBe(false);
  });

  it('returns 404 when the image does not exist', async () => {
    const res = await DELETE(new Request('http://localhost'), {
      params: { id: '987654' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await DELETE(new Request('http://localhost'), {
      params: { id: 'abc' },
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/images/:id/file — safe serving
// ---------------------------------------------------------------------------

describe('GET /api/images/:id/file', () => {
  it('serves the original bytes with the correct content-type', async () => {
    const entryId = await makeEntry();
    const buffer = await makeImageBuffer('png');
    const uploadRes = await POST(
      uploadRequest({
        file: { buffer, filename: 'serve.png', type: 'image/png' },
        entryId,
      }),
    );
    const { id } = await uploadRes.json();

    const res = await GET(new Request(`http://localhost/api/images/${id}/file`), {
      params: { id: String(id) },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const served = Buffer.from(await res.arrayBuffer());
    expect(served.length).toBe(buffer.length);
  });

  it('serves the thumbnail when variant=thumb', async () => {
    const entryId = await makeEntry();
    const buffer = await makeImageBuffer('png', 800, 500);
    const uploadRes = await POST(
      uploadRequest({
        file: { buffer, filename: 'serve.png', type: 'image/png' },
        entryId,
      }),
    );
    const { id, thumbnailFilename } = await uploadRes.json();

    const res = await GET(
      new Request(`http://localhost/api/images/${id}/file?variant=thumb`),
      { params: { id: String(id) } },
    );

    expect(res.status).toBe(200);
    const served = Buffer.from(await res.arrayBuffer());
    const onDisk = await sharp(
      path.join(uploadsDir, thumbnailFilename),
    ).metadata();
    // The thumbnail is the smaller variant, so it differs from the original.
    expect(served.length).not.toBe(buffer.length);
    expect(onDisk.width).toBeLessThanOrEqual(320);
  });

  it('returns 404 for an unknown image id', async () => {
    const res = await GET(new Request('http://localhost/api/images/55555/file'), {
      params: { id: '55555' },
    });
    expect(res.status).toBe(404);
  });

  it('never serves a path outside the uploads dir (path-safety, NFR 4.3)', async () => {
    // Seed a malicious row directly so the stored filename tries to escape.
    const entryId = await makeEntry();
    const evil = await prisma.image.create({
      data: {
        entryId,
        filename: '../../data/lexical.db',
        thumbnailFilename: '../../data/lexical.db',
        fileSize: 1,
      },
    });

    const res = await GET(
      new Request(`http://localhost/api/images/${evil.id}/file`),
      { params: { id: String(evil.id) } },
    );

    // The traversal is rejected and surfaced as a 404, never the DB file.
    expect(res.status).toBe(404);
  });
});
