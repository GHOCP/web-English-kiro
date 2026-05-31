// Safe image-serving API — `GET /api/images/:id/file` (Task 9).
//
// Serves the bytes of a stored image without ever exposing the database file
// or arbitrary filesystem paths (NFR 4.3). The client references an image by
// its database id only; the handler looks up the row, derives the stored
// *basename*, and resolves it through `resolveUploadPath` — the single
// path-safety choke point that guarantees the read stays inside the uploads
// directory. Filenames never come from the request, so traversal is impossible
// by construction.
//
// Variant selection:
//   - `?variant=thumb`  → serve the generated thumbnail (default for grids)
//   - otherwise          → serve the original
//
// Returns 404 when the image row is missing or its file is gone from disk
// (the file may have been removed out-of-band; we render a 404 rather than
// leak a filesystem error).
//
// Requirements: 4.3, NFR 4.3
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';

import { prisma } from '@/lib/db';
import { resolveUploadPath, UnsafePathError } from '@/lib/images';
import type { ApiErrorResponse } from '@/types';

/** Map a stored filename's extension to its image content-type. */
function contentTypeFor(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

/** Parse the `:id` route param into a positive integer, or null. */
function parseId(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  request: Request,
  context: { params: { id: string } },
): Promise<NextResponse> {
  const id = parseId(context.params?.id);
  if (id === null) {
    const body: ApiErrorResponse = { error: 'Invalid image id.' };
    return NextResponse.json(body, { status: 400 });
  }

  const image = await prisma.image.findUnique({ where: { id } });
  if (!image) {
    const body: ApiErrorResponse = { error: 'Image not found.' };
    return NextResponse.json(body, { status: 404 });
  }

  const variant = new URL(request.url).searchParams.get('variant');
  const filename =
    variant === 'thumb' ? image.thumbnailFilename : image.filename;

  // Resolve through the path-safety choke point. The filename comes from our
  // own DB (a generated basename), but we still validate it so a corrupted or
  // maliciously-seeded value can never escape the uploads directory.
  let absolutePath: string;
  try {
    absolutePath = resolveUploadPath(filename);
  } catch (err) {
    if (err instanceof UnsafePathError) {
      const body: ApiErrorResponse = { error: 'Image not available.' };
      return NextResponse.json(body, { status: 404 });
    }
    throw err;
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const body: ApiErrorResponse = { error: 'Image file not found.' };
      return NextResponse.json(body, { status: 404 });
    }
    throw err;
  }

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(filename),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
