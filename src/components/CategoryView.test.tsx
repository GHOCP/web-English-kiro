import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CategoryPageData } from '@/lib/pageData';
import type { CategoryTreeNode, EntryWithRelations } from '@/types';

/**
 * CategoryView integration tests (Task 19).
 *
 * Verifies the client wrapper:
 *   - picks the correct view component by `viewType` (list / genre / thesaurus
 *     / writing / speaking);
 *   - renders entry links that use the App Router `<Link>` (client-side routing,
 *     no full reload — R11.5: links point at `/entry/:id` and `/category/:id`);
 *   - records the visit in the recently-viewed cache (R11.4).
 *
 * `next/navigation` is mocked (usePathname) and `fetch` is stubbed so SWR
 * hydrates from `fallbackData` without a real network call.
 *
 * Requirements: 11.1, 11.4, 11.5, 5.4
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/category/1',
}));

import { CategoryView, categoryDataKey } from './CategoryView';
import { getRecentCategories, clearRecentCategories } from '@/lib/recentCategories';

function node(overrides: Partial<CategoryTreeNode> = {}): CategoryTreeNode {
  return {
    id: 1,
    name: 'Category',
    parentId: null,
    displayOrder: 0,
    viewType: 'list',
    partOfSpeech: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    children: [],
    ...overrides,
  } as CategoryTreeNode;
}

function entry(overrides: Partial<EntryWithRelations> = {}): EntryWithRelations {
  return {
    id: 100,
    word: 'provoke',
    pronunciation: '/prəˈvəʊk/',
    categoryId: 1,
    entryType: 'word',
    notes: null,
    displayOrder: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    category: node() as EntryWithRelations['category'],
    definitions: [
      { id: 1, entryId: 100, text: 'to annoy 激怒', partOfSpeech: null, displayOrder: 0 },
    ],
    examples: [],
    images: [],
    ...overrides,
  } as EntryWithRelations;
}

function pageData(overrides: Partial<CategoryPageData> = {}): CategoryPageData {
  const category = overrides.category ?? node();
  const entries = overrides.entries ?? [entry()];
  return {
    category,
    viewType: (overrides.viewType ?? category.viewType) as CategoryPageData['viewType'],
    entries,
    entriesByCategory:
      overrides.entriesByCategory ?? { [category.id]: entries },
  };
}

beforeEach(() => {
  clearRecentCategories();
  // Stub fetch so SWR's background revalidation resolves to the same data.
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(pageData()),
      } as Response),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CategoryView view selection', () => {
  it('renders a list view with entry links for the default viewType', () => {
    render(<CategoryView id={1} initialData={pageData({ viewType: 'list' })} />);
    const link = screen.getByRole('link', { name: 'provoke' });
    expect(link).toHaveAttribute('href', '/entry/100');
  });

  it('renders the genre grid for viewType="genre"', () => {
    render(
      <CategoryView
        id={1}
        initialData={pageData({
          category: node({ viewType: 'genre' }),
          viewType: 'genre',
        })}
      />,
    );
    // GenreGridView labels its region "Genre entries" (section + scroll
    // container both carry the label, so assert at least one is present).
    expect(screen.getAllByLabelText('Genre entries').length).toBeGreaterThan(0);
  });

  it('renders the thesaurus table for viewType="thesaurus"', () => {
    const cat = node({ id: 1, name: 'Verbs', viewType: 'thesaurus', partOfSpeech: 'V' });
    render(
      <CategoryView
        id={1}
        initialData={pageData({
          category: cat,
          viewType: 'thesaurus',
          entries: [],
          entriesByCategory: { 1: [entry()] },
        })}
      />,
    );
    // Thesaurus group table links each word to its entry detail page.
    expect(screen.getByRole('link', { name: 'provoke' })).toHaveAttribute(
      'href',
      '/entry/100',
    );
    expect(screen.getByRole('columnheader', { name: /word/i })).toBeInTheDocument();
  });

  it('renders the writing view for viewType="writing"', () => {
    render(
      <CategoryView
        id={1}
        initialData={pageData({
          category: node({ name: 'Phrases', viewType: 'writing' }),
          viewType: 'writing',
          entries: [entry({ entryType: 'phrase', word: 'as a matter of fact' })],
        })}
      />,
    );
    // The writing view groups by distinction; the "Phrases" section heading
    // (level 2) is present.
    expect(
      screen.getByRole('heading', { level: 2, name: /phrases/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('as a matter of fact')).toBeInTheDocument();
  });

  it('renders the speaking view for viewType="speaking"', () => {
    render(
      <CategoryView
        id={1}
        initialData={pageData({
          category: node({ name: 'Daily', viewType: 'speaking' }),
          viewType: 'speaking',
          entries: [
            entry({ entryType: 'speaking', word: 'How are you?', definitions: [] }),
          ],
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Daily' })).toBeInTheDocument();
  });
});

describe('CategoryView caching', () => {
  it('records the visited category in the recently-viewed cache (R11.4)', () => {
    render(<CategoryView id={1} initialData={pageData()} />);
    expect(getRecentCategories()).toEqual([1]);
  });

  it('exposes a stable SWR cache key per category id', () => {
    expect(categoryDataKey(42)).toBe('/api/categories/42');
  });
});
