import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SearchResponse } from '@/types';

/**
 * SearchResults integration tests (Task 19).
 *
 * Verifies the client results component:
 *   - renders word, owning category, and snippet for each hit, linking to the
 *     entry detail page (R6.3) via the App Router `<Link>` (R11.5);
 *   - shows a "no results" message for an empty result set (R6.4);
 *   - shows guidance for an empty query without attempting a fetch.
 *
 * `fetch` is stubbed so SWR hydrates from `fallbackData`.
 *
 * Requirements: 6.2, 6.3, 6.4, 11.5
 */

import { SearchResults, searchKey } from './SearchResults';

const sampleResponse: SearchResponse = {
  query: 'provoke',
  results: [
    {
      entryId: 100,
      word: 'provoke',
      categoryId: 5,
      categoryName: 'Verbs',
      snippet: 'to deliberately annoy someone 激怒',
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(sampleResponse),
      } as Response),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchKey', () => {
  it('returns null (no fetch) for an empty/whitespace query', () => {
    expect(searchKey('')).toBeNull();
    expect(searchKey('   ')).toBeNull();
  });

  it('builds an encoded /api/search key for a real query', () => {
    expect(searchKey('a b')).toBe('/api/search?q=a%20b');
  });
});

describe('SearchResults', () => {
  it('renders each result with word, category, and snippet linking to the entry', () => {
    render(<SearchResults query="provoke" initialResponse={sampleResponse} />);

    const wordLink = screen.getByRole('link', { name: 'provoke' });
    expect(wordLink).toHaveAttribute('href', '/entry/100');

    const categoryLink = screen.getByRole('link', { name: 'Verbs' });
    expect(categoryLink).toHaveAttribute('href', '/category/5');

    expect(
      screen.getByText('to deliberately annoy someone 激怒'),
    ).toBeInTheDocument();
  });

  it('shows a no-results message when the result set is empty', () => {
    render(
      <SearchResults
        query="zzzz"
        initialResponse={{ query: 'zzzz', results: [] }}
      />,
    );
    expect(screen.getByText(/no results found/i)).toBeInTheDocument();
  });

  it('shows guidance for an empty query', () => {
    render(
      <SearchResults query="" initialResponse={{ query: '', results: [] }} />,
    );
    expect(
      screen.getByText(/type a word or phrase to search/i),
    ).toBeInTheDocument();
  });
});
