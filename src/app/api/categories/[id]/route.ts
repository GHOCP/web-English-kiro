// Single-category route handlers (Task 7, GET added in Task 19).
//
//   GET    /api/categories/:id  → category page data (subtree + entries) (R11).
//   PATCH  /api/categories/:id  → rename / reorder / move (cycle-checked) (R1).
//   DELETE /api/categories/:id  → reassign entries OR cascade subtree (Q18).
//
// Validation + persistence live in `src/lib/validation.ts` and
// `src/lib/categories.ts`; these handlers map the request/route params to those
// services and translate `CategoryError`s into HTTP responses. The GET handler
// serves the same `CategoryPageData` the page Server Component renders, so the
// SWR client wrapper can revalidate against an identical shape (R11.1, R11.4).
//
// Requirements: 1.2, 1.3, 1.4, 1.5, 11.1, 11.4 / NFR 3.1, NFR 3.2.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateUpdateCategory, toErrorResponse } from '@/lib/validation';
import {
  updateCategory,
  deleteCategory,
  validateDeleteCategory,
  CategoryError,
} from '@/lib/categories';
import { getCategoryPageData } from '@/lib/pageData';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

/** Parse the `:id` route param into a positive integer, or `null` if invalid. */
function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const id = parseId(context.params.id);
  if (id === null) {
    return NextResponse.json({ error: 'Invalid category id.' }, { status: 400 });
  }

  try {
    const data = await getCategoryPageData(prisma, id);
    if (!data) {
      return NextResponse.json({ error: 'Category not found.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'Failed to load category.' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const id = parseId(context.params.id);
  if (id === null) {
    return NextResponse.json({ error: 'Invalid category id.' }, { status: 400 });
  }

  const body = await readJsonBody(request);
  const validation = validateUpdateCategory(body);
  if (!validation.success) {
    return NextResponse.json(toErrorResponse(validation.errors), {
      status: 400,
    });
  }

  try {
    const category = await updateCategory(prisma, id, validation.data);
    return NextResponse.json(category);
  } catch (err) {
    if (err instanceof CategoryError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    return NextResponse.json(
      { error: 'Failed to update category.' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const id = parseId(context.params.id);
  if (id === null) {
    return NextResponse.json({ error: 'Invalid category id.' }, { status: 400 });
  }

  const body = await readJsonBody(request);
  const validation = validateDeleteCategory(body);
  if (!validation.success) {
    return NextResponse.json(toErrorResponse(validation.errors), {
      status: 400,
    });
  }

  try {
    const result = await deleteCategory(prisma, id, validation.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CategoryError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    return NextResponse.json(
      { error: 'Failed to delete category.' },
      { status: 500 },
    );
  }
}
