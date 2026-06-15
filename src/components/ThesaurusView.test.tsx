import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { CategoryTreeNode, EntryWithRelations } from '@/types';
import { ThesaurusView, type EntriesByCategory } from './ThesaurusView';

/**
 * ThesaurusView component tests (Task 16).
 *
 * Verifies the thesaurus layout renders part-of-speech sections, semantic-label
 * sub-categories, and a word | pronunciation | definition table per group with
 * semantic table markup. Definition cells render Markdown (not raw). Group
 * headings link to the full group view (/category/:id) and each word links to
 * its entry detail (/entry/:id) (R9.5).
 *
 * Requirements: 2.5, 9.2, 9.3, 9.5, 3.3
 */

const TS = {
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

/** Build a category tree node with defaults. */
function cat(
  partial: Partial<CategoryTreeNode> & Pick<CategoryTreeNode, 'id' | 'name'>,
): CategoryTreeNode {
  return {
    parentId: null,
    displayOrder: 0,
    viewType: 'thesaurus',
    partOfSpeech: null,
    children: [],
    ...TS,
    ...partial,
  } as CategoryTreeNode;
}

/** Build a populated entry belonging to a category. */
function entry(
  id: number,
  categoryId: number,
  word: string,
  pronunciation: string | null,
  definitionText: string,
  displayOrder = 0,
): EntryWithRelations {
  return {
    id,
    word,
    pronunciation,
    categoryId,
    entryType: 'word',
    notes: null,
    displayOrder,
    ...TS,
    category: cat({ id: categoryId, name: 'group', viewType: 'thesaurus' }),
    definitions: [
      {
        id: id * 100,
        entryId: id,
        text: definitionText,
        partOfSpeech: null,
        displayOrder: 0,
      },
    ],
    examples: [],
    images: [],
  } as EntryWithRelations;
}

// A thesaurus subtree: Verbs (POS) → "刺激。激发" (semantic label group) with two words.
const labelGroup = cat({
  id: 30,
  name: '刺激。激发',
  viewType: 'thesaurus',
  parentId: 20,
});
const verbsSection = cat({
  id: 20,
  name: 'Verb',
  viewType: 'thesaurus',
  partOfSpeech: 'V',
  children: [labelGroup],
});
const root = cat({
  id: 10,
  name: 'Thesaurus',
  viewType: 'thesaurus',
  children: [verbsSection],
});

const entriesByCategory: EntriesByCategory = {
  30: [
    entry(1, 30, 'provoke', '/prəˈvəʊk/', 'to **incite** 煽动', 0),
    entry(2, 30, 'spur', '/spɜː/', 'to encourage 鼓动', 1),
  ],
};

describe('ThesaurusView', () => {
  it('renders the part-of-speech section heading', () => {
    render(
      <ThesaurusView category={root} entriesByCategory={entriesByCategory} />,
    );
    expect(screen.getByRole('heading', { name: /Verb/ })).toBeInTheDocument();
    // The readable part-of-speech label is surfaced.
    expect(screen.getByText('Verbs')).toBeInTheDocument();
  });

  it('renders the semantic-label group heading', () => {
    render(
      <ThesaurusView category={root} entriesByCategory={entriesByCategory} />,
    );
    expect(
      screen.getByRole('heading', { name: /刺激。激发/ }),
    ).toBeInTheDocument();
  });

  it('renders a word | pronunciation | definition table with column headers', () => {
    render(
      <ThesaurusView category={root} entriesByCategory={entriesByCategory} />,
    );
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual([
      'Word',
      'Pronunciation',
      'Definition',
    ]);
  });

  it('renders each entry word, pronunciation, and Markdown definition', () => {
    render(
      <ThesaurusView category={root} entriesByCategory={entriesByCategory} />,
    );
    expect(screen.getByRole('link', { name: 'provoke' })).toBeInTheDocument();
    expect(screen.getByText('/prəˈvəʊk/')).toBeInTheDocument();

    // "**incite**" becomes <strong>, not literal asterisks.
    const strong = screen.getByText('incite');
    expect(strong.tagName.toLowerCase()).toBe('strong');
    expect(screen.queryByText(/\*\*incite\*\*/)).toBeNull();
    expect(screen.getByText(/煽动/)).toBeInTheDocument();
  });

  it('links each word to its entry detail page', () => {
    render(
      <ThesaurusView category={root} entriesByCategory={entriesByCategory} />,
    );
    expect(screen.getByRole('link', { name: 'provoke' })).toHaveAttribute(
      'href',
      '/entry/1',
    );
    expect(screen.getByRole('link', { name: 'spur' })).toHaveAttribute(
      'href',
      '/entry/2',
    );
  });

  it('links the semantic-label group heading to its full group view', () => {
    render(
      <ThesaurusView category={root} entriesByCategory={entriesByCategory} />,
    );
    const groupLink = screen.getByRole('link', { name: /刺激。激发/ });
    expect(groupLink).toHaveAttribute('href', '/category/30');
  });

  it('orders entries within a group by displayOrder', () => {
    render(
      <ThesaurusView category={root} entriesByCategory={entriesByCategory} />,
    );
    const provoke = screen.getByRole('link', { name: 'provoke' });
    const spur = screen.getByRole('link', { name: 'spur' });
    expect(
      provoke.compareDocumentPosition(spur) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders nothing for an empty group (no table) but keeps the section heading', () => {
    render(
      <ThesaurusView category={root} entriesByCategory={{}} />,
    );
    // Structural headings still render even with no entries.
    expect(screen.getByRole('heading', { name: /Verb/ })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders multiple part-of-speech sections', () => {
    const nounGroup = cat({ id: 50, name: 'objects', parentId: 40 });
    const nounsSection = cat({
      id: 40,
      name: 'Noun',
      partOfSpeech: 'N',
      children: [nounGroup],
    });
    const multiRoot = cat({
      id: 10,
      name: 'Thesaurus',
      children: [verbsSection, nounsSection],
    });
    const entries: EntriesByCategory = {
      30: [entry(1, 30, 'provoke', null, 'def', 0)],
      50: [entry(3, 50, 'spur', null, 'a thing 物', 0)],
    };
    render(<ThesaurusView category={multiRoot} entriesByCategory={entries} />);
    expect(screen.getByText('Verbs')).toBeInTheDocument();
    expect(screen.getByText('Nouns')).toBeInTheDocument();
    // Now using grid layout instead of tables
    expect(screen.getAllByRole('article')).toHaveLength(4); // 2 entries per group * 2 groups
  });
});
