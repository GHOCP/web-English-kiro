// Client-side search results (Task 19, R6.2/R6.3/R6.4, R11.5).
//
// Renders the results for a search query and keeps them fresh as the query
// changes. The `/search` page Server Component runs the initial query against
// the database for a fast first paint and passes the result here as
// `initialResponse`; this component hydrates SWR (keyed by `/api/search?q=…`)
// with that response via `fallbackData`. When the owner types a new query the
// `SearchBar` updates the URL (`?q=`), the page re-renders with a new `query`
// prop, and SWR fetches the new results client-side — no full page reload
// (R6.3, R11.5).
//
// Each result links to its entry detail page and shows the word, owning
// category, and a definition snippet (R6.3). An empty query or an empty result
// set shows appropriate guidance (R6.4).
//
// Requirements: 6.2, 6.3, 6.4, 11.5
'use client';

import Link from 'next/link';
import useSWR from 'swr';
import type { SearchResponse } from '@/types';

export interface SearchResultsProps {
  /** The current (already-trimmed) query string from the URL. */
  query: string;
  /** SSR-computed results for `query`, used to hydrate SWR. */
  initialResponse: SearchResponse;
}

/** SWR key for a search query. Empty queries use a null key (no fetch). */
export function searchKey(query: string): string | null {
  const trimmed = query.trim();
  return trimmed.length === 0 ? null : `/api/search?q=${encodeURIComponent(trimmed)}`;
}

const fetcher = (url: string): Promise<SearchResponse> =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return res.json() as Promise<SearchResponse>;
  });

export function SearchResults({ query, initialResponse }: SearchResultsProps) {
  const trimmed = query.trim();
  const { data } = useSWR<SearchResponse>(searchKey(trimmed), fetcher, {
    fallbackData: initialResponse,
    revalidateOnFocus: false,
  });

  const response = data ?? initialResponse;
  const results = response.results;

  return (
    <section aria-labelledby="search-heading" className="mx-auto max-w-2xl">
      <h1 id="search-heading" className="text-2xl font-bold text-foreground">
        {trimmed.length === 0 ? 'Search' : `Results for “${trimmed}”`}
      </h1>

      {trimmed.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          Type a word or phrase to search the collection.
        </p>
      ) : results.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No results found for “{trimmed}”.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {results.map((result) => (
            <li key={result.entryId} className="py-3">
              <Link
                href={`/entry/${result.entryId}`}
                className="font-semibold text-writing underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                lang="en"
              >
                {result.word}
              </Link>
              <span className="ml-2 text-xs text-muted">
                in{' '}
                <Link
                  href={`/category/${result.categoryId}`}
                  className="underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                >
                  {result.categoryName}
                </Link>
              </span>
              {result.snippet ? (
                <p className="mt-1 text-sm text-foreground/90">{result.snippet}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default SearchResults;
