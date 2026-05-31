// Search results page (Task 19, R6.2/R6.3/R6.4, R11.5).
//
// A Server Component that reads the `?q=` query parameter and runs the initial
// search DIRECTLY via `searchEntries` (no HTTP round-trip) for a fast first
// paint. The computed `SearchResponse` is handed to the client `SearchResults`
// component, which hydrates SWR and fetches fresh results client-side for
// subsequent queries — so changing the query never triggers a full page reload
// (R6.3, R11.5).
//
// Requirements: 6.2, 6.3, 6.4, 11.5
import { prisma } from '@/lib/db';
import { searchEntries } from '@/lib/search';
import { SearchResults } from '@/components/SearchResults';

// Results depend on live data and the request's query string.
export const dynamic = 'force-dynamic';

interface SearchPageProps {
  searchParams: { q?: string | string[] };
}

/** Normalize the `q` search param (which may be absent or repeated) to a string. */
function readQuery(q: string | string[] | undefined): string {
  if (Array.isArray(q)) return q[0] ?? '';
  return q ?? '';
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const query = readQuery(searchParams.q);
  const initialResponse = await searchEntries(prisma, query);

  return <SearchResults query={query} initialResponse={initialResponse} />;
}
