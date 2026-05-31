// Image deletion API — `DELETE /api/images/:id` (Task 9).
//
// Looks up the `Image` row, deletes both the original and thumbnail files from
// the uploads directory, then removes the DB row. Returns 404 when the image
// does not exist.
//
// Ordering: the file delete tolerates already-missing files (see
// `deleteImageFiles`), so we delete files first and then the record. If the
// file delete throws for any reason other than "missing", we surface the error
// and leave the record intact rather than stranding files with no DB pointer.
//
// Requirements: 4.4, NFR 4.3
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { deleteImageFiles } from '@/lib/images';
import type { ApiErrorResponse } from '@/types';

/** Parse the `:id` route param into a positive integer, or null. */
function parseId(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function DELETE(
  _request: Request,
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

  // Remove both files first (missing files are tolerated), then the DB row.
  await deleteImageFiles(image.filename, image.thumbnailFilename);
  await prisma.image.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
