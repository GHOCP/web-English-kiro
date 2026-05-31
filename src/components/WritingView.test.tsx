import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  WritingView,
  deriveWritingDistinction,
  type WritingViewEntry,
} from './WritingView';

/**
 * WritingView component tests (Task 18, R13).
 *
 * Verifies that:
 *   - phrase / structure / expression entries are grouped under distinct,
 *     labelled sections so the distinction is preserved (R13.5);
 *   - the distinction is derived from `entryType`, with a category-name
 *     fallback (R13.1, R13.3);
 *   - pattern text, Chinese translations, and example sentences all render via
 *     the sanitizing Markdown component — i.e. as real HTML, not raw markers
 *     (R13.2, R13.4, R3).
 *
 * Requirements: 13.1, 13.3, 13.4, 13.5, 14.x (sibling view), NFR 2.1
 */

function entry(over: Partial<WritingViewEntry> & { id: number }): WritingViewEntry {
  return {
    word: 'word',
    pronunciation: null,
    entryType: 'phrase',
    notes: null,
    definitions: [],
    examples: [],
    category: null,
    ...over,
  };
}

const mixed: WritingViewEntry[] = [
  entry({
    id: 1,
    word: 'break bread with sb',
    entryType: 'phrase',
    definitions: [{ text: '与某人共餐' }],
    examples: [{ text: 'We **broke bread** together.' }],
  }),
  entry({
    id: 2,
    word: 'It is not until ... that ...',
    entryType: 'structure',
    definitions: [{ text: '直到……才……' }],
  }),
  entry({
    id: 3,
    word: 'In my humble opinion, ...',
    entryType: 'expression',
    definitions: [{ text: '依我拙见' }],
  }),
];

describe('WritingView', () => {
  it('renders a labelled section for each distinction present', () => {
    render(<WritingView entries={mixed} />);

    expect(
      screen.getByRole('heading', { name: 'Phrases', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Structures', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Expressions', level: 2 }),
    ).toBeInTheDocument();
  });

  it('places each entry under its own distinction section', () => {
    render(<WritingView entries={mixed} />);

    const phrases = screen
      .getByRole('heading', { name: 'Phrases' })
      .closest('section') as HTMLElement;
    const structures = screen
      .getByRole('heading', { name: 'Structures' })
      .closest('section') as HTMLElement;
    const expressions = screen
      .getByRole('heading', { name: 'Expressions' })
      .closest('section') as HTMLElement;

    expect(within(phrases).getByText('break bread with sb')).toBeInTheDocument();
    expect(
      within(structures).getByText(/It is not until/),
    ).toBeInTheDocument();
    expect(
      within(expressions).getByText(/In my humble opinion/),
    ).toBeInTheDocument();

    // The structure pattern must NOT leak into the phrases section.
    expect(
      within(phrases).queryByText(/It is not until/),
    ).not.toBeInTheDocument();
  });

  it('tags each entry with its derived distinction for visual distinction', () => {
    const { container } = render(<WritingView entries={mixed} />);
    const distinctions = Array.from(
      container.querySelectorAll('[data-distinction]'),
    ).map((el) => el.getAttribute('data-distinction'));
    expect(distinctions).toContain('phrase');
    expect(distinctions).toContain('structure');
    expect(distinctions).toContain('expression');
  });

  it('renders translations and examples as Markdown (not raw markers)', () => {
    const { container } = render(<WritingView entries={[mixed[0]]} />);

    // The Chinese translation is shown.
    expect(screen.getByText('与某人共餐')).toBeInTheDocument();

    // The example's **bold** becomes a <strong>, not literal asterisks.
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('broke bread');
    expect(container.textContent).not.toContain('**broke bread**');
  });

  it('derives the distinction from category name when entryType is absent', () => {
    expect(
      deriveWritingDistinction(
        entry({ id: 9, entryType: null, category: { name: 'Structure' } }),
      ),
    ).toBe('structure');
    expect(
      deriveWritingDistinction(
        entry({ id: 10, entryType: undefined, category: { name: 'Expressions' } }),
      ),
    ).toBe('expression');
    // Unknown / empty hints fall back to phrase.
    expect(
      deriveWritingDistinction(entry({ id: 11, entryType: null, category: null })),
    ).toBe('phrase');
  });

  it('omits sections that have no entries', () => {
    render(<WritingView entries={[mixed[0]]} />);
    expect(screen.getByRole('heading', { name: 'Phrases' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Structures' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Expressions' }),
    ).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no entries', () => {
    render(<WritingView entries={[]} />);
    expect(screen.getByText(/no writing entries yet/i)).toBeInTheDocument();
  });
});
