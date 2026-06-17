import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntryWithRelations } from '@/types';

/**
 * EntryEditor component tests (Task 15).
 *
 * Covers the behaviours called out by the task:
 *   - adding a definition row adds another text field,
 *   - removing a definition row removes it,
 *   - client validation surfaces inline errors (empty word, empty definition),
 *   - a 409 from the server shows the duplicate message,
 *   - a 400 with fieldErrors maps to inline messages,
 *   - a successful create submits POST and reports the saved entry.
 *
 * `swr`'s `useSWRConfig` is mocked so the editor can call `mutate` for cache
 * revalidation without a real SWR provider. `global.fetch` is mocked per test
 * to drive the submit paths. The shared `Markdown` component is mocked to a
 * trivial passthrough so the live preview does not pull in the full
 * react-markdown/rehype pipeline during component tests.
 *
 * Requirements: 2.1, 2.2, 2.4, 3.2, 3.4, 4.3
 */

const mutate = vi.fn().mockResolvedValue(undefined);
vi.mock('swr', () => ({
  useSWRConfig: () => ({ mutate }),
}));

vi.mock('@/components/Markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { EntryEditor } from './EntryEditor';

/** Build a fully-populated entry for edit-mode tests. */
function makeEntry(overrides: Partial<EntryWithRelations> = {}): EntryWithRelations {
  const base = {
    id: 7,
    word: 'provoke',
    pronunciation: '/prəˈvəʊk/',
    categoryId: 3,
    entryType: 'word',
    notes: null,
    displayOrder: 0,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    definitions: [
      { id: 1, entryId: 7, text: 'to incite', partOfSpeech: 'v', displayOrder: 0 },
    ],
    examples: [{ id: 1, entryId: 7, text: 'don’t provoke him', displayOrder: 0 }],
    images: [],
    category: {
      id: 3,
      name: 'Verbs',
      parentId: null,
      displayOrder: 0,
      viewType: 'list',
      partOfSpeech: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    },
  } as unknown as EntryWithRelations;
  return { ...base, ...overrides };
}

beforeEach(() => {
  mutate.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('EntryEditor', () => {
  it('renders an accessible labelled dialog', () => {
    render(<EntryEditor categoryId={3} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: /new entry/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('adds a definition row when "Add definition" is clicked', async () => {
    const user = userEvent.setup();
    render(<EntryEditor categoryId={3} onClose={() => {}} />);

    // One definition row to start.
    expect(screen.getAllByLabelText(/definition \d+ text/i)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /add definition/i }));

    expect(screen.getAllByLabelText(/definition \d+ text/i)).toHaveLength(2);
  });

  it('removes a definition row when its Remove button is clicked', async () => {
    const user = userEvent.setup();
    render(<EntryEditor categoryId={3} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /add definition/i }));
    expect(screen.getAllByLabelText(/definition \d+ text/i)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /remove definition 2/i }));
    expect(screen.getAllByLabelText(/definition \d+ text/i)).toHaveLength(1);
  });

  it('adds and removes example rows dynamically', async () => {
    const user = userEvent.setup();
    render(<EntryEditor categoryId={3} onClose={() => {}} />);

    // No example rows initially.
    expect(screen.queryAllByLabelText(/example \d+ text/i)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /add example/i }));
    expect(screen.getAllByLabelText(/example \d+ text/i)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /remove example 1/i }));
    expect(screen.queryAllByLabelText(/example \d+ text/i)).toHaveLength(0);
  });

  it('shows an inline error when the word is empty on submit', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(<EntryEditor categoryId={3} onClose={() => {}} />);

    // Fill a valid definition so the only error is the empty word.
    await user.type(screen.getByLabelText(/definition 1 text/i), 'a meaning');
    await user.click(screen.getByRole('button', { name: /create entry/i }));

    expect(
      await screen.findByText(/word is required and cannot be empty/i),
    ).toBeInTheDocument();
    // Client validation should block the network request entirely.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows an inline error when a definition is empty on submit', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(<EntryEditor categoryId={3} onClose={() => {}} />);

    await user.type(screen.getByLabelText(/^word/i), 'provoke');
    // Leave the definition empty.
    await user.click(screen.getByRole('button', { name: /create entry/i }));

    expect(
      await screen.findByText(/text is required and cannot be empty/i),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('submits a POST and reports the saved entry on success', async () => {
    const user = userEvent.setup();
    const saved = makeEntry({ id: 42, word: 'incite', images: [] });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => saved,
    });
    vi.stubGlobal('fetch', fetchSpy);
    const onSaved = vi.fn();

    render(<EntryEditor categoryId={3} onSaved={onSaved} onClose={() => {}} />);

    await user.type(screen.getByLabelText(/^word/i), 'incite');
    await user.type(screen.getByLabelText(/definition 1 text/i), 'to provoke');
    await user.click(screen.getByRole('button', { name: /create entry/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));

    // Posted to the create endpoint with the expected method + body.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/entries');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.word).toBe('incite');
    expect(body.categoryId).toBe(3);
    expect(body.definitions[0].text).toBe('to provoke');

    // Cache revalidation triggered.
    expect(mutate).toHaveBeenCalled();
  });

  it('lets the owner pick a sub-category and posts the selected categoryId', async () => {
    const user = userEvent.setup();
    const saved = makeEntry({ id: 43, word: 'incite', images: [] });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => saved,
    });
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <EntryEditor
        categoryId={1}
        categoryOptions={[
          { id: 1, name: 'A~Z', depth: 0 },
          { id: 2, name: '#A', depth: 1 },
          { id: 3, name: 'B', depth: 1 },
        ]}
        onClose={() => {}}
      />,
    );

    // The picker defaults to the open category…
    const select = screen.getByLabelText(/^category/i) as HTMLSelectElement;
    expect(select.value).toBe('1');

    // …and the owner can file the entry into a specific bucket instead.
    await user.selectOptions(select, '3');
    await user.type(screen.getByLabelText(/^word/i), 'incite');
    await user.type(screen.getByLabelText(/definition 1 text/i), 'to provoke');
    await user.click(screen.getByRole('button', { name: /create entry/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.categoryId).toBe(3);
  });

  it('omits the category picker when no options are supplied', () => {
    render(<EntryEditor categoryId={3} onClose={() => {}} />);
    expect(screen.queryByLabelText(/^category/i)).toBeNull();
  });

  it('shows the duplicate message on a 409 response', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Duplicate entry' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    render(<EntryEditor categoryId={3} onClose={() => {}} />);

    await user.type(screen.getByLabelText(/^word/i), 'provoke');
    await user.type(screen.getByLabelText(/definition 1 text/i), 'to incite');
    await user.click(screen.getByRole('button', { name: /create entry/i }));

    expect(
      await screen.findByText(/already exists in this category/i),
    ).toBeInTheDocument();
  });

  it('maps server 400 fieldErrors to inline messages', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Validation failed',
        fieldErrors: [{ field: 'word', message: 'Server rejected this word.' }],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    render(<EntryEditor categoryId={3} onClose={() => {}} />);

    // Provide client-valid input so the request actually reaches the server.
    await user.type(screen.getByLabelText(/^word/i), 'provoke');
    await user.type(screen.getByLabelText(/definition 1 text/i), 'to incite');
    await user.click(screen.getByRole('button', { name: /create entry/i }));

    expect(
      await screen.findByText(/server rejected this word/i),
    ).toBeInTheDocument();
  });

  it('pre-populates fields in edit mode and submits a PATCH', async () => {
    const user = userEvent.setup();
    const entry = makeEntry();
    const updated = makeEntry({ word: 'provoke!' });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => updated,
    });
    vi.stubGlobal('fetch', fetchSpy);
    const onSaved = vi.fn();

    render(<EntryEditor entry={entry} onSaved={onSaved} onClose={() => {}} />);

    // Existing values are present.
    expect(screen.getByLabelText(/^word/i)).toHaveValue('provoke');
    expect(screen.getByLabelText(/definition 1 text/i)).toHaveValue('to incite');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/entries/7');
    expect(init.method).toBe('PATCH');
  });

  it('disables image upload until the entry is saved (create mode)', () => {
    render(<EntryEditor categoryId={3} onClose={() => {}} />);
    expect(
      screen.getByText(/save the entry first to attach images/i),
    ).toBeInTheDocument();
  });

  it('shows the image upload control in edit mode', () => {
    render(<EntryEditor entry={makeEntry()} onClose={() => {}} />);
    expect(screen.getByLabelText(/upload image/i)).toBeInTheDocument();
  });

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EntryEditor categoryId={3} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the Close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<EntryEditor categoryId={3} onClose={onClose} />);

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^close$/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
