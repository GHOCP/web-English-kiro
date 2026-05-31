// Category collection route handlers (Task 7).
//
//   GET  /api/categories  → full nested category tree (R1, R5).
//   POST /api/categories  → create a category, incl. thesaurus groups (R1, R9).
//
// The heavy lifting lives in the framework-free service layer
// (`src/lib/categories.ts`) so it can be unit/property tested directly against
// an isolated SQLite database without an HTTP server. These handlers only deal
// with request parsing, validation, and HTTP status mapping.
//
// Requirements: 1.1, 1.2, 1.3, 9.1, 9.4 / NFR 3.1, NFR 3.2.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateCreateCategory, toErrorResponse } from '@/lib/validation';
import {
  getCategoryTree,
  createCategory,
  CategoryError,
} from '@/lib/categories';

// Always run dynamically; this data is request-time and must never be cached.
export const dynamic = 'force-dynamic';

/** Parse a JSON request body, returning `undefined` on empty/invalid JSON. */
async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const tree = await getCategoryTree(prisma);
    return NextResponse.json(tree);
  } catch {
    return NextResponse.json(
      { error: 'Failed to load categories.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await readJsonBody(request);

  const validation = validateCreateCategory(body);
  if (!validation.success) {
    return NextResponse.json(toErrorResponse(validation.errors), {
      status: 400,
    });
  }

  try {
    const category = await createCategory(prisma, validation.data);
    return NextResponse.json(category, { status: 201 });
  } catch (err) {
    if (err instanceof CategoryError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    return NextResponse.json(
      { error: 'Failed to create category.' },
      { status: 500 },
    );
  }
}
