// Reusable virtualized list (Task 17, Q17 + R11).
//
// A generic wrapper around `@tanstack/react-virtual` (`useVirtualizer`) that
// renders a large list of `items` inside a single scrollable container while
// only mounting the rows currently in view (plus an overscan buffer). This lets
// large categories and thesaurus sections live on one scrollable page — the
// legacy "everything on one page" reading experience — without paying the cost
// of mounting hundreds/thousands of DOM rows at once.
//
// How it works:
//   - The scroll container (`overflow:auto`, fixed height) is the measured
//     viewport. The virtualizer reads its height and the current scroll offset
//     to decide which row indices are visible.
//   - An inner spacer is sized to the *total* height of all rows
//     (`getTotalSize()`), so the native scrollbar reflects the full list.
//   - Only the visible window of rows is rendered, each absolutely positioned
//     at its computed offset.
//
// Row sizing: rows use a fixed estimated size (`estimateRowSize`). We do NOT
// attach a dynamic-measurement ref, so every row keeps the estimated height.
// This keeps the mounted-row count fully determined by the viewport height and
// the estimate — predictable, fast, and testable in environments (like jsdom)
// that do not implement layout.
//
// Requirements: 10.4, 11.1, 11.4
'use client';

import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface VirtualListProps<T> {
  /** The full list of items. Only the visible subset is ever mounted. */
  items: T[];
  /** Renders a single item into a row. Receives the item and its index. */
  renderRow: (item: T, index: number) => ReactNode;
  /** Estimated (and, here, fixed) row height in pixels. */
  estimateRowSize: number;
  /** Extra rows to render above/below the viewport for smoother scrolling. */
  overscan?: number;
  /** Height of the scroll viewport (number = px). Defaults to `100%`. */
  height?: number | string;
  /** Optional class applied to the scroll container. */
  className?: string;
  /** Accessible label for the scroll region. */
  ariaLabel?: string;
  /**
   * Test/SSR seam: an initial viewport rect to use before the real element is
   * measured. Environments without layout (jsdom) can supply this so the
   * virtualizer can compute a range. In the browser the real measured rect
   * takes over immediately.
   */
  initialRect?: { width: number; height: number };
  /** Stable key for an item; defaults to the index. */
  getItemKey?: (item: T, index: number) => string | number;
}

/**
 * Virtualized, single-page scrolling list. Generic over the item type so it can
 * back genre grids, thesaurus tables, and any other large list view.
 */
export function VirtualList<T>({
  items,
  renderRow,
  estimateRowSize,
  overscan = 4,
  height = '100%',
  className,
  ariaLabel,
  initialRect,
  getItemKey,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowSize,
    overscan,
    ...(initialRect ? { initialRect } : {}),
    ...(getItemKey
      ? { getItemKey: (index: number) => getItemKey(items[index], index) }
      : {}),
  });

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      data-testid="virtual-scroll-container"
      aria-label={ariaLabel}
      className={className}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        overflow: 'auto',
      }}
    >
      {/* Spacer sized to the full list so the scrollbar reflects every row. */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualRows.map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            data-virtual-row=""
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderRow(items[virtualRow.index], virtualRow.index)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default VirtualList;
