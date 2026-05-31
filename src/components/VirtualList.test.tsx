import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VirtualList } from './VirtualList';

/**
 * VirtualList component tests (Task 17).
 *
 * The whole point of VirtualList is that a large list mounts only the rows in
 * view (plus overscan), not every row. We assert that here.
 *
 * jsdom does not implement layout or `ResizeObserver`, both of which
 * `@tanstack/react-virtual` relies on to size the scroll viewport and measure
 * rows. We therefore:
 *   - install a no-op `ResizeObserver` stub so the virtualizer can subscribe;
 *   - stub `getBoundingClientRect` on the scroll container to report a fixed
 *     viewport height (the `initialRect` prop also seeds the first pass);
 * Rows keep their fixed estimated height (the component attaches no dynamic
 * measurement ref), so the number of mounted rows is fully determined by the
 * viewport height and the estimate — making the bounded-mount assertion
 * deterministic.
 *
 * Requirements: 10.4, 11.1, 11.4
 */

const VIEWPORT_HEIGHT = 500;
const ROW_HEIGHT = 50;

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let rectSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);

  // Report a fixed viewport height for every element that is measured. The
  // scroll container is the one the virtualizer reads; reporting a finite
  // height bounds the visible row window.
  rectSpy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(
      () =>
        ({
          width: 800,
          height: VIEWPORT_HEIGHT,
          top: 0,
          left: 0,
          right: 800,
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

function buildItems(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `item-${i}`);
}

describe('VirtualList', () => {
  it('mounts only a bounded number of rows for a large dataset', () => {
    const items = buildItems(1000);

    render(
      <VirtualList
        items={items}
        estimateRowSize={ROW_HEIGHT}
        height={VIEWPORT_HEIGHT}
        overscan={4}
        initialRect={{ width: 800, height: VIEWPORT_HEIGHT }}
        renderRow={(item) => <div data-testid="row">{item}</div>}
      />,
    );

    const mounted = screen.getAllByTestId('row');

    // A 500px viewport with 50px rows fits ~10 rows. With overscan and a
    // boundary partial row the mounted count stays well under the full 1000.
    // Generous upper bound proves virtualization without being brittle.
    const visibleEstimate = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT); // 10
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThanOrEqual(visibleEstimate + 2 * 4 + 2);
    expect(mounted.length).toBeLessThan(items.length);
    // Hard ceiling far below the dataset size.
    expect(mounted.length).toBeLessThan(50);
  });

  it('sizes the inner spacer to the full list height', () => {
    const items = buildItems(1000);

    render(
      <VirtualList
        items={items}
        estimateRowSize={ROW_HEIGHT}
        height={VIEWPORT_HEIGHT}
        initialRect={{ width: 800, height: VIEWPORT_HEIGHT }}
        renderRow={(item) => <div data-testid="row">{item}</div>}
      />,
    );

    const container = screen.getByTestId('virtual-scroll-container');
    const spacer = container.firstElementChild as HTMLElement;
    // Total scrollable height reflects every row (1000 * 50 = 50000px), so the
    // scrollbar represents the full list even though few rows are mounted.
    expect(spacer.style.height).toBe(`${items.length * ROW_HEIGHT}px`);
  });

  it('renders the first items starting from the top of the list', () => {
    const items = buildItems(1000);

    render(
      <VirtualList
        items={items}
        estimateRowSize={ROW_HEIGHT}
        height={VIEWPORT_HEIGHT}
        initialRect={{ width: 800, height: VIEWPORT_HEIGHT }}
        renderRow={(item) => <div data-testid="row">{item}</div>}
      />,
    );

    // The very first item is mounted; an item far down the list is not.
    expect(screen.getByText('item-0')).toBeInTheDocument();
    expect(screen.queryByText('item-900')).not.toBeInTheDocument();
  });

  it('mounts every row when the dataset is small', () => {
    const items = buildItems(3);

    render(
      <VirtualList
        items={items}
        estimateRowSize={ROW_HEIGHT}
        height={VIEWPORT_HEIGHT}
        initialRect={{ width: 800, height: VIEWPORT_HEIGHT }}
        renderRow={(item) => <div data-testid="row">{item}</div>}
      />,
    );

    expect(screen.getAllByTestId('row')).toHaveLength(3);
  });

  it('applies the accessible label to the scroll region', () => {
    render(
      <VirtualList
        items={buildItems(10)}
        estimateRowSize={ROW_HEIGHT}
        height={VIEWPORT_HEIGHT}
        ariaLabel="Big list"
        initialRect={{ width: 800, height: VIEWPORT_HEIGHT }}
        renderRow={(item) => <div data-testid="row">{item}</div>}
      />,
    );

    expect(screen.getByLabelText('Big list')).toBeInTheDocument();
  });
});
