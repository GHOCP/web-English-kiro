// Genre grid view (Task 17, R10).
//
// Renders genre-category entries in a dense, multi-column grid where each cell
// shows the word, its meaning (first definition, rendered as sanitized
// Markdown), and an optional image thumbnail. This mirrors the legacy
// "3-entries-per-row" genre tables (index03-words_by_genres) while using the
// generated thumbnails (Q15) and the safe Markdown renderer.
//
// Large categories are rendered through `VirtualList`: entries are chunked into
// rows of `columns`, and only the rows currently in view are mounted. The whole
// category therefore lives on a single scrollable page (the legacy reading
// experience) without mounting hundreds of DOM rows at once (R11.1, R11.4).
//
// Accessibility (NFR 2.1):
//   - each cell is an <article> labelled by its word;
//   - the word is a heading, meaning/pronunciation are described inline;
//   - thumbnails always carry alt text (the stored altText, falling back to the
//     word) so screen readers announce them meaningfully.
//
// Requirements: 10.1, 10.2, 10.3, 10.4
'use client';

import { Markdown } from '@/components/Markdown';
import { VirtualList } from '@/components/VirtualList';
import type { EntryWithRelations } from '@/types';

/** A genre entry only needs its definitions + images to render a cell. */
export type GenreEntry = Pick<
  EntryWithRelations,
  'id' | 'word' | 'pronunciation'
> & {
  definitions: { id: number; text: string }[];
  images: { id: number; altText: string | null }[];
};

export interface GenreGridViewProps {
  /** Entries to display, in their intended display order. */
  entries: GenreEntry[];
  /** Entries per row (the legacy layout uses 3). */
  columns?: number;
  /** Fixed row height in px used for virtualization. */
  rowHeight?: number;
  /** Height of the scroll viewport (number = px). */
  height?: number | string;
  /** Overscan rows above/below the viewport. */
  overscan?: number;
  /** Accessible label for the grid region. */
  ariaLabel?: string;
  /**
   * Test/SSR seam forwarded to `VirtualList`: an initial viewport rect so the
   * virtualizer can compute a bounded range before the element is measured.
   */
  initialRect?: { width: number; height: number };
}

/** Build the thumbnail URL for a stored image id (served safely by the API). */
export function thumbnailUrl(imageId: number): string {
  return `/api/images/${imageId}/file?variant=thumb`;
}

/** Split a flat list into fixed-size chunks (rows of `size` columns). */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

/** A single entry cell: word | meaning | optional thumbnail. */
function GenreCell({ entry }: { entry: GenreEntry }) {
  const meaning = entry.definitions[0]?.text ?? '';
  const image = entry.images[0];

  return (
    <article
      aria-label={entry.word}
      className="flex h-full gap-3 rounded-md border border-border bg-surface p-3"
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">{entry.word}</h3>
        {entry.pronunciation ? (
          <p className="text-xs text-muted">{entry.pronunciation}</p>
        ) : null}
        {meaning ? (
          <Markdown className="mt-1 text-sm text-foreground/90">
            {meaning}
          </Markdown>
        ) : null}
      </div>
      {image ? (
        <img
          src={thumbnailUrl(image.id)}
          alt={image.altText?.trim() ? image.altText : entry.word}
          width={80}
          height={80}
          loading="lazy"
          className="h-20 w-20 shrink-0 rounded object-cover"
        />
      ) : null}
    </article>
  );
}

/** One virtualized row holding up to `columns` cells. */
function GenreRow({
  rowEntries,
  columns,
}: {
  rowEntries: GenreEntry[];
  columns: number;
}) {
  return (
    <div
      className="grid gap-3 px-1 pb-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {rowEntries.map((entry) => (
        <GenreCell key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

export function GenreGridView({
  entries,
  columns = 3,
  rowHeight = 140,
  height = 600,
  overscan = 2,
  ariaLabel = 'Genre entries',
  initialRect,
}: GenreGridViewProps) {
  if (entries.length === 0) {
    return (
      <p className="px-2 py-4 text-sm text-muted">No entries in this genre yet.</p>
    );
  }

  const rows = chunk(entries, columns);

  return (
    <section aria-label={ariaLabel}>
      <VirtualList
        items={rows}
        estimateRowSize={rowHeight}
        height={height}
        overscan={overscan}
        ariaLabel={ariaLabel}
        initialRect={initialRect}
        getItemKey={(rowEntries) => rowEntries[0]?.id ?? -1}
        renderRow={(rowEntries) => (
          <GenreRow rowEntries={rowEntries} columns={columns} />
        )}
      />
    </section>
  );
}

export default GenreGridView;
