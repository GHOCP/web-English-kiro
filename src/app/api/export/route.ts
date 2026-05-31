// GET /api/export?format=&categoryId= — Export the collection (R8).
//
// Exports either the whole collection (no `categoryId`) or a single category
// subtree, in one of three formats:
//   - json     → nested, round-trippable ExportDocument
//   - csv      → flat rows (word, pronunciation, definitions, examples,
//                category, subcategory)
//   - markdown → human-readable, one section per category
//
// The heavy lifting lives in `src/lib/export` so it is unit-testable and
// reusable (Task 14's round-trip property test calls the same code). This
// handler only parses/validates query params and sets transport headers.
//
// Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { exportCollection } from '@/lib/export';
import type { ApiErrorResponse, ExportFormat } from '@/types';

/** Formats accepted on the `format` query parameter. */
const VALID_FORMATS: readonly ExportFormat[] = ['json', 'csv', 'markdown'];

function isExportFormat(value: string): value is ExportFormat {
  return (VALID_FORMATS as readonly string[]).includes(value);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  // --- format (required) -------------------------------------------------
  const formatParam = searchParams.get('format');
  if (!formatParam) {
    return NextResponse.json<ApiErrorResponse>(
      {
        error: 'Missing required query parameter: format',
        fieldErrors: [{ field: 'format', message: 'format is required' }],
      },
      { status: 400 },
    );
  }
  if (!isExportFormat(formatParam)) {
    return NextResponse.json<ApiErrorResponse>(
      {
        error: `Invalid format "${formatParam}". Expected one of: ${VALID_FORMATS.join(', ')}`,
        fieldErrors: [
          { field: 'format', message: `must be one of ${VALID_FORMATS.join(', ')}` },
        ],
      },
      { status: 400 },
    );
  }

  // --- categoryId (optional) --------------------------------------------
  let categoryId: number | undefined;
  const categoryIdParam = searchParams.get('categoryId');
  if (categoryIdParam !== null && categoryIdParam !== '') {
    const parsed = Number(categoryIdParam);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json<ApiErrorResponse>(
        {
          error: `Invalid categoryId "${categoryIdParam}". Expected a positive integer.`,
          fieldErrors: [
            { field: 'categoryId', message: 'must be a positive integer' },
          ],
        },
        { status: 400 },
      );
    }
    categoryId = parsed;
  }

  // --- run the export ----------------------------------------------------
  try {
    const { body, contentType, filename } = await exportCollection(prisma, {
      format: formatParam,
      categoryId,
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    // A missing category id is the only expected domain error here (404).
    if (err instanceof Error && /not found/i.test(err.message)) {
      return NextResponse.json<ApiErrorResponse>(
        { error: err.message },
        { status: 404 },
      );
    }
    return NextResponse.json<ApiErrorResponse>(
      { error: 'Failed to export collection' },
      { status: 500 },
    );
  }
}
