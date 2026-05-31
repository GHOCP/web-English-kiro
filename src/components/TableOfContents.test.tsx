import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TableOfContents, type TocSection } from './TableOfContents';

/**
 * TableOfContents component tests (Task 13).
 *
 * IntersectionObserver does not exist in jsdom, so we install a controllable
 * mock that captures the callback and lets the test "scroll" a section into
 * view by invoking it with synthetic entries. We then assert the highlighted
 * item tracks the visible section (`aria-current="location"`).
 *
 * Requirements: 5.3, 5.5, NFR 2.1, NFR 2.2, NFR 2.4
 */

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

let lastCallback: IOCallback | null = null;
const observeSpy = vi.fn();
const disconnectSpy = vi.fn();

class MockIntersectionObserver {
  constructor(cb: IOCallback) {
    lastCallback = cb;
  }
  observe = observeSpy;
  unobserve = vi.fn();
  disconnect = disconnectSpy;
  takeRecords = () => [];
  root = null;
  rootMargin = '';
  thresholds = [];
}

/** Build a synthetic IntersectionObserverEntry for a given element + state. */
function entryFor(
  id: string,
  isIntersecting: boolean,
  top: number,
): IntersectionObserverEntry {
  const target = document.getElementById(id) as Element;
  return {
    target,
    isIntersecting,
    boundingClientRect: { top } as DOMRectReadOnly,
    intersectionRatio: isIntersecting ? 1 : 0,
    intersectionRect: {} as DOMRectReadOnly,
    rootBounds: null,
    time: 0,
  } as IntersectionObserverEntry;
}

const sections: TocSection[] = [
  { id: 'intro', label: 'Introduction' },
  { id: 'usage', label: 'Usage' },
  { id: 'api', label: 'API' },
];

beforeEach(() => {
  lastCallback = null;
  observeSpy.mockClear();
  disconnectSpy.mockClear();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

  // Provide real DOM targets for the observer to watch.
  for (const section of sections) {
    const el = document.createElement('section');
    el.id = section.id;
    document.body.appendChild(el);
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('TableOfContents', () => {
  it('renders an accessible TOC landmark with all sections', () => {
    render(<TableOfContents sections={sections} />);
    const nav = screen.getByRole('navigation', { name: /table of contents/i });
    expect(nav).toBeInTheDocument();
    for (const section of sections) {
      expect(
        screen.getByRole('link', { name: section.label }),
      ).toBeInTheDocument();
    }
  });

  it('links each item to its section anchor', () => {
    render(<TableOfContents sections={sections} />);
    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute(
      'href',
      '#usage',
    );
  });

  it('observes every section element', () => {
    render(<TableOfContents sections={sections} />);
    expect(observeSpy).toHaveBeenCalledTimes(sections.length);
  });

  it('highlights the section currently in view', () => {
    render(<TableOfContents sections={sections} />);

    // Initially the first section is the default active item.
    expect(screen.getByRole('link', { name: 'Introduction' })).toHaveAttribute(
      'aria-current',
      'location',
    );

    // Simulate scrolling so the "Usage" section becomes the topmost visible.
    act(() => {
      lastCallback?.([
        entryFor('intro', false, -50),
        entryFor('usage', true, 20),
        entryFor('api', true, 400),
      ]);
    });

    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(
      screen.getByRole('link', { name: 'Introduction' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('picks the topmost section when multiple are visible', () => {
    render(<TableOfContents sections={sections} />);

    act(() => {
      lastCallback?.([
        entryFor('api', true, 300),
        entryFor('usage', true, 80),
      ]);
    });

    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute(
      'aria-current',
      'location',
    );
  });

  it('renders nothing when there are no sections', () => {
    const { container } = render(<TableOfContents sections={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<TableOfContents sections={sections} />);
    unmount();
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
