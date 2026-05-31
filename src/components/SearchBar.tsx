// Search bar (Task 13, R6).
//
// Always-accessible search input that lives in the app header. Typing is
// debounced (default 280ms) and then navigates to `/search?q=` via the App
// Router, so results render client-side without a full page reload (R11.5).
// Submitting the form (Enter) navigates immediately, bypassing the debounce.
//
// Accessibility: it is a real <form role="search"> with a labelled <input>
// (NFR 2.1, NFR 2.4) and is fully keyboard operable (NFR 2.2).
//
// Requirements: 6.1, 5.x, 11.5, NFR 2.1, NFR 2.2, NFR 2.4
'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SearchBarProps {
  /** Debounce window in milliseconds before auto-navigating. */
  debounceMs?: number;
  /** Optional initial query (e.g. hydrating the box on the search page). */
  initialQuery?: string;
  /** Placeholder text for the input. */
  placeholder?: string;
}

/** Build the search URL for a query, trimming and URL-encoding the term. */
export function buildSearchHref(query: string): string {
  return `/search?q=${encodeURIComponent(query.trim())}`;
}

export function SearchBar({
  debounceMs = 280,
  initialQuery = '',
  placeholder = 'Search words and definitions…',
}: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  // Track the last value we navigated for so the debounce effect does not fire
  // a redundant push on mount or immediately after a manual submit.
  const lastNavigated = useRef(initialQuery.trim());

  useEffect(() => {
    const trimmed = query.trim();

    // Don't navigate on empty input or when nothing changed since last nav.
    if (trimmed.length === 0 || trimmed === lastNavigated.current) {
      return;
    }

    const handle = setTimeout(() => {
      lastNavigated.current = trimmed;
      router.push(buildSearchHref(trimmed));
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [query, debounceMs, router]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    lastNavigated.current = trimmed;
    router.push(buildSearchHref(trimmed));
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="w-full max-w-md">
      <label htmlFor="site-search" className="sr-only">
        Search the lexical collection
      </label>
      <input
        id="site-search"
        type="search"
        name="q"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-label="Search the lexical collection"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
      />
    </form>
  );
}

export default SearchBar;
