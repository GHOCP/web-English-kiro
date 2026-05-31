// GET /api/search?q= — basic search across the lexical collection (R6, R11).
//
// Thin HTTP adapter over `searchEntries` (src/lib/search.ts). It reads the `q`
// query parameter, delegates all matching/ranking/snippet logic to the library,
// and returns a `SearchResponse`. An empty or whitespace-only query returns an
// empty result set without touching the database (handled in the library).
//
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 11.2
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { searchEntries } from '@/lib/search';
import type { SearchResponse } from '@/types';

// Search reads live data and must reflect the current database state, so the
// route is always dynamic (never statically cached).
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse<SearchResponse>> {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') ?? '';

  const response = await searchEntries(prisma, query);
  return NextResponse.json(response);
}
