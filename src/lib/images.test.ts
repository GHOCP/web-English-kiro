import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  THUMBNAIL_MAX_DIMENSION,
  detectImageType,
  validateImage,
  generateFilenames,
  resolveUploadPath,
  storeImage,
  deleteImageFiles,
  getUploadsDir,
  ImageValidationError,
  UnsafePathError,
} from './images';

/**
 * Unit tests for the image storage + Sharp thumbnail helpers (Task 6).
 *
 * Covers: MIME sniffing from magic bytes, size + type validation, spoofed-MIME
 * rejection, thumbnail generation with bounded dimensions, deletion of both
 * files (tolerating missing files), and path-traversal rejection.
 *
 * Requirements: 4.1, 4.2, 4.4, NFR 4.2, NFR 4.3
 */

// ---------------------------------------------------------------------------
// Helpers: generate small, real image buffers with Sharp.
// ---------------------------------------------------------------------------

async function makeImage(
  format: 'jpeg' | 'png' | 'webp',
  width = 600,
  height = 400,
): Promise<Buffer> {
  const base = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 80, b: 200 },
    },
  });
  if (format === 'jpeg') return base.jpeg().toBuffer();
  if (format === 'png') return base.png().toBuffer();
  return base.webp().toBuffer();
}

let uploadsDir: string;

beforeEach(() => {
  uploadsDir = mkdtempSync(path.join(tmpdir(), 'lexical-uploads-'));
});

afterEach(() => {
  rmSync(uploadsDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// MIME sniffing (NFR 4.2)
// ---------------------------------------------------------------------------

describe('detectImageType', () => {
  it('detects JPEG from magic bytes (FF D8 FF)', async () => {
    const buf = await makeImage('jpeg');
    expect(detectImageType(buf)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
  });

  it('detects PNG from magic bytes (89 50 4E 47)', async () => {
    const buf = await makeImage('png');
    expect(detectImageType(buf)).toEqual({ mime: 'image/png', ext: 'png' });
  });

  it('detects WebP from RIFF....WEBP header', async () => {
    const buf = await makeImage('webp');
    expect(detectImageType(buf)).toEqual({ mime: 'image/webp', ext: 'webp' });
  });

  it('returns null for non-image data', () => {
    expect(detectImageType(Buffer.from('this is plain text, not an image'))).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });

  it('does not misidentify a RIFF container that is not WEBP (e.g. WAV)', () => {
    // "RIFF" + size + "WAVE"
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'ascii'),
    ]);
    expect(detectImageType(wav)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Validation (R4.1, NFR 4.2)
// ---------------------------------------------------------------------------

describe('validateImage', () => {
  it('accepts a valid JPEG/PNG/WebP', async () => {
    for (const fmt of ['jpeg', 'png', 'webp'] as const) {
      const buf = await makeImage(fmt);
      const result = validateImage(buf);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(ALLOWED_IMAGE_MIME_TYPES).toContain(result.type.mime);
      }
    }
  });

  it('rejects an empty buffer', () => {
    const result = validateImage(Buffer.alloc(0));
    expect(result).toMatchObject({ ok: false, code: 'EMPTY' });
  });

  it('rejects a buffer over the 5MB limit', () => {
    // A buffer with a JPEG header but larger than the limit.
    const oversized = Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    const result = validateImage(oversized);
    expect(result).toMatchObject({ ok: false, code: 'TOO_LARGE' });
  });

  it('rejects unsupported types (e.g. GIF / plain text)', () => {
    const gif = Buffer.from('GIF89a');
    expect(validateImage(gif)).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_TYPE',
    });
  });

  it('rejects a spoofed MIME (declared PNG but bytes are JPEG)', async () => {
    const buf = await makeImage('jpeg');
    const result = validateImage(buf, 'image/png');
    expect(result).toMatchObject({ ok: false, code: 'MIME_MISMATCH' });
  });

  it('accepts when the declared MIME matches the sniffed type', async () => {
    const buf = await makeImage('png');
    expect(validateImage(buf, 'image/png').ok).toBe(true);
  });

  it('treats a text file renamed with a declared image MIME as unsupported (content wins)', () => {
    const fake = Buffer.from('definitely not an image');
    // Even though the caller claims image/jpeg, the bytes are not an image.
    expect(validateImage(fake, 'image/jpeg')).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_TYPE',
    });
  });
});

// ---------------------------------------------------------------------------
// Filename generation (R4.2)
// ---------------------------------------------------------------------------

describe('generateFilenames', () => {
  it('produces {uuid}.{ext} and {uuid}.thumb.{ext} sharing a uuid', () => {
    const { filename, thumbnailFilename } = generateFilenames('jpg');
    expect(filename).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(thumbnailFilename).toMatch(/^[0-9a-f-]{36}\.thumb\.jpg$/);
    const uuid = filename.split('.')[0];
    expect(thumbnailFilename).toBe(`${uuid}.thumb.jpg`);
  });

  it('produces unique names across calls', () => {
    const a = generateFilenames('png');
    const b = generateFilenames('png');
    expect(a.filename).not.toBe(b.filename);
  });
});

// ---------------------------------------------------------------------------
// Path safety (NFR 4.3)
// ---------------------------------------------------------------------------

describe('resolveUploadPath', () => {
  it('resolves a plain basename inside the uploads dir', () => {
    const resolved = resolveUploadPath('abc.jpg', uploadsDir);
    expect(resolved).toBe(path.join(path.resolve(uploadsDir), 'abc.jpg'));
    expect(resolved.startsWith(path.resolve(uploadsDir))).toBe(true);
  });

  it.each([
    '../secret.txt',
    '../../data/lexical.db',
    'sub/dir.jpg',
    'sub\\dir.jpg',
    '..',
    '/etc/passwd',
    '/Users/x/data/lexical.db',
  ])('rejects traversal/escaping path %s', (name) => {
    expect(() => resolveUploadPath(name, uploadsDir)).toThrow(UnsafePathError);
  });

  it('rejects empty and null-byte filenames', () => {
    expect(() => resolveUploadPath('', uploadsDir)).toThrow(UnsafePathError);
    expect(() => resolveUploadPath('a\0b.jpg', uploadsDir)).toThrow(UnsafePathError);
  });

  it('never resolves to the database file path', () => {
    // Any attempt to reach the data/ DB file is blocked.
    expect(() => resolveUploadPath('../data/lexical.db', uploadsDir)).toThrow(
      UnsafePathError,
    );
  });
});

describe('getUploadsDir', () => {
  it('defaults to an absolute uploads/ path', () => {
    const prev = process.env.UPLOADS_DIR;
    delete process.env.UPLOADS_DIR;
    try {
      expect(getUploadsDir()).toBe(path.resolve('uploads'));
    } finally {
      if (prev !== undefined) process.env.UPLOADS_DIR = prev;
    }
  });

  it('honors the UPLOADS_DIR env var', () => {
    const prev = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = uploadsDir;
    try {
      expect(getUploadsDir()).toBe(path.resolve(uploadsDir));
    } finally {
      if (prev === undefined) delete process.env.UPLOADS_DIR;
      else process.env.UPLOADS_DIR = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Store + thumbnail (R4.1, R4.2, Q15)
// ---------------------------------------------------------------------------

describe('storeImage', () => {
  it('writes the original and a bounded thumbnail for each format', async () => {
    for (const fmt of ['jpeg', 'png', 'webp'] as const) {
      const buf = await makeImage(fmt, 800, 500);
      const stored = await storeImage(buf, { uploadsDir });

      const originalPath = path.join(uploadsDir, stored.filename);
      const thumbPath = path.join(uploadsDir, stored.thumbnailFilename);
      expect(existsSync(originalPath)).toBe(true);
      expect(existsSync(thumbPath)).toBe(true);
      expect(stored.fileSize).toBe(buf.length);
      expect(stored.width).toBe(800);
      expect(stored.height).toBe(500);

      const thumbMeta = await sharp(thumbPath).metadata();
      expect(thumbMeta.width).toBeLessThanOrEqual(THUMBNAIL_MAX_DIMENSION);
      expect(thumbMeta.height).toBeLessThanOrEqual(THUMBNAIL_MAX_DIMENSION);
      // Longest edge should be exactly the bound for a downscaled landscape image.
      expect(thumbMeta.width).toBe(THUMBNAIL_MAX_DIMENSION);
    }
  });

  it('does not enlarge images smaller than the thumbnail bound', async () => {
    const small = await makeImage('png', 100, 80);
    const stored = await storeImage(small, { uploadsDir });
    const thumbMeta = await sharp(
      path.join(uploadsDir, stored.thumbnailFilename),
    ).metadata();
    expect(thumbMeta.width).toBe(100);
    expect(thumbMeta.height).toBe(80);
  });

  it('throws ImageValidationError for an invalid buffer', async () => {
    await expect(
      storeImage(Buffer.from('not an image'), { uploadsDir }),
    ).rejects.toBeInstanceOf(ImageValidationError);
  });

  it('throws ImageValidationError for a spoofed declared MIME', async () => {
    const buf = await makeImage('jpeg');
    await expect(
      storeImage(buf, { uploadsDir, declaredMime: 'image/png' }),
    ).rejects.toMatchObject({ code: 'MIME_MISMATCH' });
  });

  it('creates the uploads directory if it does not yet exist', async () => {
    const nested = path.join(uploadsDir, 'nested', 'deeper');
    const buf = await makeImage('png');
    const stored = await storeImage(buf, { uploadsDir: nested });
    expect(existsSync(path.join(nested, stored.filename))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Delete (R4.4)
// ---------------------------------------------------------------------------

describe('deleteImageFiles', () => {
  it('removes both the original and the thumbnail', async () => {
    const buf = await makeImage('jpeg');
    const stored = await storeImage(buf, { uploadsDir });
    const originalPath = path.join(uploadsDir, stored.filename);
    const thumbPath = path.join(uploadsDir, stored.thumbnailFilename);
    expect(existsSync(originalPath)).toBe(true);
    expect(existsSync(thumbPath)).toBe(true);

    await deleteImageFiles(stored.filename, stored.thumbnailFilename, uploadsDir);

    expect(existsSync(originalPath)).toBe(false);
    expect(existsSync(thumbPath)).toBe(false);
  });

  it('tolerates missing files (idempotent / partial state)', async () => {
    const { filename, thumbnailFilename } = generateFilenames('png');
    // Nothing was written; deleting must not throw.
    await expect(
      deleteImageFiles(filename, thumbnailFilename, uploadsDir),
    ).resolves.toBeUndefined();

    // Only the original exists; thumbnail missing — still fine.
    const onlyOriginal = generateFilenames('jpg');
    writeFileSync(path.join(uploadsDir, onlyOriginal.filename), 'x');
    await expect(
      deleteImageFiles(
        onlyOriginal.filename,
        onlyOriginal.thumbnailFilename,
        uploadsDir,
      ),
    ).resolves.toBeUndefined();
    expect(existsSync(path.join(uploadsDir, onlyOriginal.filename))).toBe(false);
  });

  it('rejects path-traversal filenames on delete', async () => {
    await expect(
      deleteImageFiles('../secret.txt', '../../data/lexical.db', uploadsDir),
    ).rejects.toBeInstanceOf(UnsafePathError);
  });
});
