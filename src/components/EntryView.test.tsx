import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EntryWithRelations } from '@/types';
import { EntryView } from './EntryView';

/**
 * EntryView component tests (Task 16).
 *
 * Verifies the read/detail view renders every populated field with a clear
 * hierarchy: word + pronunciation, entry-type, ordered definitions (with
 * optional part-of-speech), examples, notes, and image thumbnails that link to
 * the original. Markdown text is rendered as HTML (not shown raw), and entries
 * in a thesaurus category surface a link to the full group.
 *
 * Requirements: 2.4, 2.5, 9.2, 9.3, 9.5, 3.3
 */

const baseCategory = {
  id: 10,
  name: 'General',
  parentId: null,
  displayOrder: 0,
  viewType: 'list',
  partOfSpeech: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
} as EntryWithRelations['category'];

/** Build a fully-populated entry with sensible defaults, overridable per test. */
function makeEntry(overrides: Partial<EntryWithRelations> = {}): EntryWithRelations {
  return {
    id: 1,
    word: 'provoke',
    pronunciation: '/prəˈvəʊk/',
    categoryId: 10,
    entryType: 'word',
    notes: null,
    displayOrder: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    category: baseCategory,
    definitions: [
      {
        id: 100,
        entryId: 1,
        text: 'to **deliberately** annoy someone 激怒',
        partOfSpeech: 'v.',
        displayOrder: 0,
      },
    ],
    examples: [
      {
        id: 200,
        entryId: 1,
        text: 'His comments _provoked_ a strong reaction.',
        displayOrder: 0,
      },
    ],
    images: [],
    ...overrides,
  } as EntryWithRelations;
}

describe('EntryView', () => {
  it('renders the word and pronunciation', () => {
    render(<EntryView entry={makeEntry()} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'provoke' }),
    ).toBeInTheDocument();
    expect(screen.getByText('/prəˈvəʊk/')).toBeInTheDocument();
  });

  it('renders definitions with Markdown formatting (not raw)', () => {
    render(<EntryView entry={makeEntry()} />);
    // "**deliberately**" must become <strong>, not literal asterisks.
    const strong = screen.getByText('deliberately');
    expect(strong.tagName.toLowerCase()).toBe('strong');
    expect(screen.queryByText(/\*\*deliberately\*\*/)).not.toBeInTheDocument();
    // Chinese text is preserved alongside English.
    expect(screen.getByText(/激怒/)).toBeInTheDocument();
  });

  it('renders the optional part-of-speech for a definition', () => {
    render(<EntryView entry={makeEntry()} />);
    expect(screen.getByText('v.')).toBeInTheDocument();
  });

  it('renders examples with Markdown formatting', () => {
    render(<EntryView entry={makeEntry()} />);
    const em = screen.getByText('provoked');
    expect(em.tagName.toLowerCase()).toBe('em');
  });

  it('renders notes when present', () => {
    render(
      <EntryView entry={makeEntry({ notes: 'Often used in **formal** writing.' })} />,
    );
    const heading = screen.getByRole('heading', { name: /notes/i });
    expect(heading).toBeInTheDocument();
    const strong = screen.getByText('formal');
    expect(strong.tagName.toLowerCase()).toBe('strong');
  });

  it('omits sections that have no data', () => {
    render(
      <EntryView
        entry={makeEntry({ examples: [], notes: null, images: [] })}
      />,
    );
    expect(screen.queryByRole('heading', { name: /examples?/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /notes/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /images?/i })).toBeNull();
  });

  it('renders multiple definitions ordered by displayOrder', () => {
    const entry = makeEntry({
      definitions: [
        { id: 2, entryId: 1, text: 'second sense', partOfSpeech: null, displayOrder: 1 },
        { id: 1, entryId: 1, text: 'first sense', partOfSpeech: null, displayOrder: 0 },
      ],
    });
    render(<EntryView entry={entry} />);
    // Resolve order by querying the rendered text positions.
    const first = screen.getByText('first sense');
    const second = screen.getByText('second sense');
    expect(
      first.compareDocumentPosition(second) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders image thumbnails linking to the original', () => {
    const entry = makeEntry({
      images: [
        {
          id: 55,
          entryId: 1,
          filename: 'provoke.jpg',
          thumbnailFilename: 'provoke.thumb.jpg',
          altText: 'a provoking scene',
          fileSize: 1234,
        },
      ],
    });
    render(<EntryView entry={entry} />);

    const img = screen.getByRole('img', { name: 'a provoking scene' });
    expect(img).toHaveAttribute('src', '/api/images/55/file?variant=thumb');

    const link = img.closest('a');
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', '/api/images/55/file');
  });

  it('falls back to the word for image alt text when none is provided', () => {
    const entry = makeEntry({
      images: [
        {
          id: 7,
          entryId: 1,
          filename: 'x.jpg',
          thumbnailFilename: 'x.thumb.jpg',
          altText: null,
          fileSize: 10,
        },
      ],
    });
    render(<EntryView entry={entry} />);
    expect(screen.getByRole('img', { name: 'provoke' })).toBeInTheDocument();
  });

  it('does NOT show a thesaurus group link for non-thesaurus entries', () => {
    render(<EntryView entry={makeEntry()} />);
    expect(
      screen.queryByRole('link', { name: /view full thesaurus group/i }),
    ).toBeNull();
  });

  it('surfaces a link to the full group when the entry is in a thesaurus category', () => {
    const entry = makeEntry({
      categoryId: 42,
      category: {
        ...baseCategory,
        id: 42,
        name: '刺激。激发',
        viewType: 'thesaurus',
        partOfSpeech: 'V',
      } as EntryWithRelations['category'],
    });
    render(<EntryView entry={entry} />);

    const link = screen.getByRole('link', { name: /view full thesaurus group/i });
    expect(link).toHaveAttribute('href', '/category/42');
  });

  it('renders the entry-type label', () => {
    render(<EntryView entry={makeEntry({ entryType: 'phrase' })} />);
    expect(screen.getByText('Phrase')).toBeInTheDocument();
  });
});
