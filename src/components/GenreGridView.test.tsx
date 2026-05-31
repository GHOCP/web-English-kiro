import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  GenreGridView,
  chunk,
  thumbnailUrl,
  type GenreEntry,
} from './GenreGridView';

/**
 * GenreGridView component tests (Task 17, R10).
 *
 * Covers the dense multi-column layout (word | meaning | thumbnail), the use of
 * the safe thumbnail endpoint with alt text, and — crucially — that a large
 * genre renders through VirtualList so only a bounded number of rows mount.
 *
 * As in VirtualList.test.tsx, jsdom has no layout/ResizeObserver, so we stub a
 * no-op ResizeObserver and a fixed viewport rect, and pass `initialRect` so the
 * virtualizer can compute a bounded visible window deterministically.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 11.1, 11.4
 */

const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 140;

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let rectSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  rectSpy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(
      () =>
        ({
          width: 900,
          height: VIEWPORT_HEIGHT,
          top: 0,
          left: 0,
          right: 900,
          bottom: VIEWPORT_HEIGHT,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
});

afterEach(() => {
  rectSpy?.mockRestore();
  vi.unstubAllGlobals();
});

function makeEntry(i: number, withImage = true): GenreEntry {
  return {
    id: i + 1,
    word: `word-${i}`,
    pronunciation: i % 2 === 0 ? `/pron-${i}/` : null,
    definitions: [{ id: i + 1, text: `meaning **${i}**` }],
    images: withImage ? [{ id: 1000 + i, altText: null }] : [],
  };
}

function makeEntries(count: number, withImage = true): GenreEntry[] {
  return Array.from({ length: count }, (_, i) => makeEntry(i, withImage));
}

describe('chunk', () => {
  it('splits a list into fixed-size rows', () => {
    expect(chunk([1, 2, 3, 4, 5], 3)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it('returns a single row for non-positive sizes', () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });
});

describe('thumbnailUrl', () => {
  it('targets the safe thumbnail endpoint', () => {
    expect(thumbnailUrl(42)).toBe('/api/images/42/file?variant=thumb');
  });
});

describe('GenreGridView', () => {
  it('renders word, meaning, and thumbnail for an entry', () => {
    render(
      <GenreGridView
        entries={[makeEntry(0)]}
        initialRect={{ width: 900, height: VIEWPORT_HEIGHT }}
      />,
    );

    // Word as a heading.
    expect(
      screen.getByRole('heading', { name: 'word-0' }),
    ).toBeInTheDocument();
    // Pronunciation rendered for even index.
    expect(screen.getByText('/pron-0/')).toBeInTheDocument();
    // Meaning rendered via Markdown (bold emphasis survives).
    expect(screen.getByText('0').tagName.toLowerCase()).toBe('strong');
    // Thumbnail from the safe endpoint, alt falls back to the word.
    const img = screen.getByRole('img', { name: 'word-0' });
    expect(img).toHaveAttribute('src', '/api/images/1000/file?variant=thumb');
  });

  it('uses the stored alt text when present', () => {
    const entry = makeEntry(0);
    entry.images = [{ id: 7, altText: 'a ripe fig' }];

    render(
      <GenreGridView
        entries={[entry]}
        initialRect={{ width: 900, height: VIEWPORT_HEIGHT }}
      />,
    );

    expect(screen.getByRole('img', { name: 'a ripe fig' })).toBeInTheDocument();
  });

  it('omits the image when an entry has none', () => {
    render(
      <GenreGridView
        entries={[makeEntry(0, false)]}
        initialRect={{ width: 900, height: VIEWPORT_HEIGHT }}
      />,
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders entries in a multi-column dense grid', () => {
    render(
      <GenreGridView
        entries={makeEntries(3)}
        columns={3}
        initialRect={{ width: 900, height: VIEWPORT_HEIGHT }}
      />,
    );

    const row = document.querySelector('[data-virtual-row] > div') as HTMLElement;
    expect(row.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  });

  it('mounts only a bounded number of rows for a large genre (virtualization)', () => {
    // 1000 entries / 3 columns ≈ 334 rows. With a 600px viewport and 140px
    // rows only a handful of rows should mount.
    const entries = makeEntries(1000);

    render(
      <GenreGridView
        entries={entries}
        columns={3}
        rowHeight={ROW_HEIGHT}
        height={VIEWPORT_HEIGHT}
        overscan={2}
        initialRect={{ width: 900, height: VIEWPORT_HEIGHT }}
      />,
    );

    const totalRows = Math.ceil(entries.length / 3); // 334
    const mountedRows = document.querySelectorAll('[data-virtual-row]');

    const visibleEstimate = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT); // ~5
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThanOrEqual(visibleEstimate + 2 * 2 + 2);
    expect(mountedRows.length).toBeLessThan(totalRows);
    // Hard ceiling far below the total row count.
    expect(mountedRows.length).toBeLessThan(20);

    // The first entry is mounted; one far down the list is not.
    expect(screen.getByRole('heading', { name: 'word-0' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'word-900' }),
    ).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no entries', () => {
    render(<GenreGridView entries={[]} />);
    expect(screen.getByText(/no entries in this genre yet/i)).toBeInTheDocument();
  });
});
