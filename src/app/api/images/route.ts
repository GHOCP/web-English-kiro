// Image upload API — `POST /api/images` (Task 9).
//
// Accepts a multipart/form-data upload, validates it (MIME sniffing + size via
// the Task 6 image library), writes the original plus a Sharp thumbnail into
// the uploads directory, and persists an `Image` row.
//
// Because `Image.entryId` is required by the schema (an image always belongs to
// an entry — see prisma/schema.prisma), the upload must reference an existing
// entry via the `entryId` form field. A missing/invalid `entryId`, or one that
// does not resolve to a real entry, is rejected with a 400 field error.
//
// Form fields:
//   - file:     the image (JPEG/PNG/WebP, ≤ 5MB)            [required]
//   - entryId:  the entry to attach the image to            [required]
//   - altText:  optional alternative text                   [optional]
//
// On success returns 201 with the persisted `Image` record including the
// generated `thumbnailFilename` (ImageUploadResponse).
//
// Files are written *before* the DB row is created; if the row insert fails
// (e.g. the entry was deleted between the existence check and the write) the
// just-written files are cleaned up so no orphaned files are stranded.
//
// Requirements: 4.1, 4.2, 4.3, 4.4, NFR 4.2, NFR 4.3
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import {
  storeImage,
  deleteImageFiles,
  ImageValidationError,
} from '@/lib/images';
import { toErrorResponse } from '@/lib/validation';
import type { ImageUploadResponse, ApiErrorResponse } from '@/types';

/** Parse a form field that should be a positive-integer id. */
function parsePositiveIntField(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Parse the multipart body.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    const body: ApiErrorResponse = {
      error: 'Expected a multipart/form-data upload.',
    };
    return NextResponse.json(body, { status: 400 });
  }

  // 2. The file field must be present and look like an uploaded file.
  const fileField = formData.get('file');
  if (!(fileField instanceof Blob) || typeof fileField.arrayBuffer !== 'function') {
    return NextResponse.json(
      toErrorResponse(
        [{ field: 'file', message: 'An image file is required.' }],
        'Invalid image upload',
      ),
      { status: 400 },
    );
  }

  // 3. entryId is required and must reference an existing entry (the Image
  //    schema requires entryId — every image belongs to an entry).
  const entryId = parsePositiveIntField(formData.get('entryId'));
  if (entryId === null) {
    return NextResponse.json(
      toErrorResponse(
        [{ field: 'entryId', message: 'A valid entryId is required.' }],
        'Invalid image upload',
      ),
      { status: 400 },
    );
  }

  const entry = await prisma.entry.findUnique({ where: { id: entryId } });
  if (!entry) {
    return NextResponse.json(
      toErrorResponse(
        [{ field: 'entryId', message: 'Entry not found.' }],
        'Invalid image upload',
      ),
      { status: 400 },
    );
  }

  // 4. Optional alt text.
  const altRaw = formData.get('altText');
  const altText =
    typeof altRaw === 'string' && altRaw.trim().length > 0
      ? altRaw.trim()
      : null;

  // 5. Read the bytes and store (validates size/type, writes original + thumb).
  const buffer = Buffer.from(await fileField.arrayBuffer());
  const declaredMime = fileField.type || undefined;

  let stored;
  try {
    stored = await storeImage(buffer, { declaredMime });
  } catch (err) {
    if (err instanceof ImageValidationError) {
      return NextResponse.json(
        toErrorResponse(
          [{ field: 'file', message: err.message }],
          'Invalid image upload',
        ),
        { status: 400 },
      );
    }
    throw err;
  }

  // 6. Persist the DB row. If this fails, remove the files we just wrote so we
  //    never leave orphaned files behind.
  try {
    const image = await prisma.image.create({
      data: {
        entryId,
        filename: stored.filename,
        thumbnailFilename: stored.thumbnailFilename,
        altText,
        fileSize: stored.fileSize,
      },
    });

    const body: ImageUploadResponse = {
      id: image.id,
      filename: image.filename,
      thumbnailFilename: image.thumbnailFilename,
      altText: image.altText,
      fileSize: image.fileSize,
    };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    await deleteImageFiles(stored.filename, stored.thumbnailFilename).catch(
      () => {
        /* best-effort cleanup; ignore secondary failures */
      },
    );
    throw err;
  }
}
