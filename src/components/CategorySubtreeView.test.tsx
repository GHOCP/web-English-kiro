import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { CategoryTreeNode, EntryWithRelations } from '@/types';
import { CategorySubtreeView } from './CategorySubtreeView';
import type { EntriesByCategory } from './ThesaurusView';

/**
 * CategorySubtreeView tests (sidebar-flattening change).
 *
 * The sidebar now only shows top-level categories + their direct children, so
 * the category page must render the FULL subtree and surface deeper
 * sub-categories as in-content headers (otherwise their entries are
 * unreachable). These tests verify that behavior across view types.
 */

const TS = {
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

function cat(
  partial: Partial<CategoryTreeNode> & Pick<CategoryTreeNode, 'id' | 'name'>,
): CategoryTreeNode {
  return {
    parentId: null,
    displayOrder: 0,
    viewType: 'list',
    partOfSpeech: null,
    children: [],
    ...TS,
    ...partial,
  } as CategoryTreeNode;
}

function entry(
  id: number,
  categoryId: number,
  word: string,
  over: Partial<EntryWithRelations> = {},
): EntryWithRelations {
  return {
    id,
    word,
    pronunciation: null,
    categoryId,
    entryType: 'word',
    notes: null,
    displayOrder: 0,
    ...TS,
    category: cat({ id: categoryId, name: 'c' }) as EntryWithRelations['category'],
    definitions: [
      { id: id * 10, entryId: id, text: 'meaning', partOfSpeech: null, displayOrder: 0 },
    ],
    examples: [],
    images: [],
    ...over,
  } as EntryWithRelations;
}

describe('CategorySubtreeView', () => {
  it('renders deeper sub-categories as in-content headings with their entries', () => {
    // A ~ Z (root) → "#A" (sub) holding two entries. The sub-category, no longer
    // in the sidebar, must appear as a heading here.
    const sub = cat({ id: 2, name: '#A', parentId: 1 });
    const root = cat({ id: 1, name: 'A ~ Z', children: [sub] });
    const entriesByCategory: EntriesByCategory = {
      2: [
        entry(10, 2, 'adhere', { pronunciation: '/ədˈhɪə/' }),
        entry(11, 2, 'abolish'),
      ],
    };

    render(
      <CategorySubtreeView
        category={root}
        entriesByCategory={entriesByCategory}
        viewType="list"
      />,
    );

    const heading = screen.getByRole('heading', { name: '#A' });
    expect(heading).toBeInTheDocument();
    // The heading links to the sub-category's own page.
    expect(within(heading).getByRole('link', { name: '#A' })).toHaveAttribute(
      'href',
      '/category/2',
    );

    // Entries render as cards in a grid (Word + Pronunciation + Meaning),
    // two per row for the A~Z buckets.
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('/ədˈhɪə/')).toBeInTheDocument();

    // Both entries render and link to their detail pages.
    expect(screen.getByRole('link', { name: 'adhere' })).toHaveAttribute(
      'href',
      '/entry/10',
    );
    expect(screen.getByRole('link', { name: 'abolish' })).toBeInTheDocument();
  });

  it('does not render a heading for the root category itself', () => {
    const root = cat({ id: 1, name: 'A ~ Z' });
    render(
      <CategorySubtreeView
        category={root}
        entriesByCategory={{ 1: [entry(10, 1, 'adhere')] }}
        viewType="list"
      />,
    );
    // The page supplies the root title separately, so the subtree view must not
    // duplicate it as a heading.
    expect(screen.queryByRole('heading', { name: 'A ~ Z' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'adhere' })).toBeInTheDocument();
  });

  it('renders a speaking subtree as dialogue blocks under sub-category headers', () => {
    const scene = cat({ id: 2, name: 'Shopping', parentId: 1, viewType: 'speaking' });
    const root = cat({ id: 1, name: 'Scenes', viewType: 'speaking', children: [scene] });
    render(
      <CategorySubtreeView
        category={root}
        entriesByCategory={{
          2: [
            entry(10, 2, '-- Can I help you?\n-- I am just looking.', {
              entryType: 'speaking',
              definitions: [],
            }),
          ],
        }}
        viewType="speaking"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Shopping' })).toBeInTheDocument();
    const dialogue = screen.getByRole('list', { name: /dialogue/i });
    const turns = within(dialogue).getAllByRole('listitem');
    expect(turns).toHaveLength(2);
    expect(dialogue.textContent).not.toContain('--');
  });

  it('renders a genre subtree entry as an article with a thumbnail', () => {
    const sub = cat({ id: 2, name: 'Vegetables', parentId: 1, viewType: 'genre' });
    const root = cat({ id: 1, name: 'Genres', viewType: 'genre', children: [sub] });
    render(
      <CategorySubtreeView
        category={root}
        entriesByCategory={{
          2: [
            entry(10, 2, 'spinach', {
              images: [
                {
                  id: 500,
                  entryId: 10,
                  filename: 'spinach.jpg',
                  thumbnailFilename: 'spinach-thumb.jpg',
                  altText: null,
                  fileSize: 1,
                } as EntryWithRelations['images'][number],
              ],
            }),
          ],
        }}
        viewType="genre"
      />,
    );

    const article = screen.getByRole('article', { name: 'spinach' });
    const img = within(article).getByRole('img', { name: 'spinach' });
    expect(img).toHaveAttribute('src', '/api/images/500/file?variant=thumb');
  });

  it('shows an empty state for a category with no entries and no children', () => {
    const root = cat({ id: 1, name: 'Empty' });
    render(
      <CategorySubtreeView category={root} entriesByCategory={{}} viewType="list" />,
    );
    expect(screen.getByText(/no entries in this category yet/i)).toBeInTheDocument();
  });
});
