import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  SpeakingView,
  splitDialogueLines,
  type SpeakingViewEntry,
} from './SpeakingView';

/**
 * SpeakingView component tests (Task 18, R14).
 *
 * Verifies that:
 *   - entries are grouped by situation type via their owning category (R14.3);
 *   - dialogue text with "-- " turn markers / line breaks renders as separate
 *     conversational turns in a readable layout (R14.4);
 *   - Chinese translations and usage notes render via Markdown (not raw
 *     markers) alongside the dialogue (R14.2, R3).
 *
 * Requirements: 14.1, 14.3, 14.4, NFR 2.1
 */

function entry(
  over: Partial<SpeakingViewEntry> & { id: number },
): SpeakingViewEntry {
  return {
    word: 'Hello.',
    definitions: [],
    notes: null,
    category: null,
    ...over,
  };
}

const entries: SpeakingViewEntry[] = [
  entry({
    id: 1,
    word: '-- Can I help you find something?\n-- I am just looking right now.',
    definitions: [{ text: '我周围看看' }],
    category: { id: 100, name: 'Shopping' },
  }),
  entry({
    id: 2,
    word: '-- I will take it.',
    definitions: [{ text: '我买了。' }],
    category: { id: 100, name: 'Shopping' },
  }),
  entry({
    id: 3,
    word: 'Merry Christmas with lots of love.',
    definitions: [{ text: '祝福。' }],
    notes: 'A warm **festive** greeting.',
    category: { id: 200, name: 'Christmas' },
  }),
];

describe('SpeakingView', () => {
  it('groups entries by situation type (category name)', () => {
    render(<SpeakingView entries={entries} />);

    expect(
      screen.getByRole('heading', { name: 'Shopping', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Christmas', level: 2 }),
    ).toBeInTheDocument();

    const shopping = screen
      .getByRole('heading', { name: 'Shopping' })
      .closest('section') as HTMLElement;
    // Both shopping entries live under the Shopping section.
    expect(
      within(shopping).getByText(/Can I help you find something/),
    ).toBeInTheDocument();
    expect(within(shopping).getByText(/I will take it/)).toBeInTheDocument();
    // The Christmas entry does not.
    expect(
      within(shopping).queryByText(/Merry Christmas/),
    ).not.toBeInTheDocument();
  });

  it('renders multi-turn dialogue as separate conversational lines', () => {
    render(<SpeakingView entries={[entries[0]]} />);

    const dialogue = screen.getByRole('list', { name: /dialogue/i });
    const turns = within(dialogue).getAllByRole('listitem');
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveTextContent('Can I help you find something?');
    expect(turns[1]).toHaveTextContent('I am just looking right now.');

    // The "--" turn markers are stripped from the displayed text.
    expect(dialogue.textContent).not.toContain('--');
  });

  it('shows the Chinese translation alongside the dialogue', () => {
    render(<SpeakingView entries={[entries[0]]} />);
    expect(screen.getByText('我周围看看')).toBeInTheDocument();
  });

  it('renders usage notes as Markdown (not raw markers)', () => {
    const { container } = render(<SpeakingView entries={[entries[2]]} />);
    const strong = container.querySelector('strong');
    expect(strong?.textContent).toBe('festive');
    expect(container.textContent).not.toContain('**festive**');
  });

  it('falls back to a default situation when no category is given', () => {
    render(
      <SpeakingView entries={[entry({ id: 5, word: 'Good morning.' })]} />,
    );
    expect(
      screen.getByRole('heading', { name: 'Phrases', level: 2 }),
    ).toBeInTheDocument();
  });

  it('shows an empty state when there are no entries', () => {
    render(<SpeakingView entries={[]} />);
    expect(screen.getByText(/no speaking entries yet/i)).toBeInTheDocument();
  });
});

describe('splitDialogueLines', () => {
  it('splits on newlines and "--" turn markers, trimming markers', () => {
    expect(
      splitDialogueLines('-- Hello?\n-- Hi there.'),
    ).toEqual(['Hello?', 'Hi there.']);
  });

  it('handles inline "-- " markers without newlines', () => {
    expect(splitDialogueLines('-- On what? -- Everything.')).toEqual([
      'On what?',
      'Everything.',
    ]);
  });

  it('returns a single line for plain text', () => {
    expect(splitDialogueLines('Merry Christmas.')).toEqual(['Merry Christmas.']);
  });

  it('drops empty fragments', () => {
    expect(splitDialogueLines('\n\n-- Hi\n\n')).toEqual(['Hi']);
  });
});
