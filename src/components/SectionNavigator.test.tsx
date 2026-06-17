import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CategoryTreeNode } from '@/types';
import { SectionNavigator, flattenSections } from './SectionNavigator';

/**
 * SectionNavigator tests (sidebar-flattening change).
 *
 * The floating navigator lists a category's sub-categories and scrolls to the
 * matching in-content header. jsdom lacks IntersectionObserver and
 * scrollIntoView, so both are stubbed.
 */

const TS = {
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

function cat(
  partial: Partial<CategoryTreeNode> & Pick<CategoryTreeNode, 'id' | 'name'>,
): CategoryTreeNode {
  return {
    parentId: null,
    displayOrder: 0,
    viewType: 'list',
    partOfSpeech: null,
    children: [],
    ...TS,
    ...partial,
  } as CategoryTreeNode;
}

// Root "A ~ Z" with two sub-categories, one of which nests a grandchild.
const grandchild = cat({ id: 3, name: '#A-sub', parentId: 2, displayOrder: 0 });
const childA = cat({ id: 2, name: '#A', parentId: 1, displayOrder: 0, children: [grandchild] });
const childB = cat({ id: 4, name: '#B', parentId: 1, displayOrder: 1 });
const root = cat({ id: 1, name: 'A ~ Z', children: [childA, childB] });

class NoopIO {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', NoopIO);
  scrollSpy = vi.fn();
  // jsdom has no scrollIntoView.
  (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView =
    scrollSpy;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('flattenSections', () => {
  it('flattens descendant sub-categories depth-first, excluding the root', () => {
    expect(flattenSections(root)).toEqual([
      { id: 2, name: '#A', depth: 1 },
      { id: 3, name: '#A-sub', depth: 2 },
      { id: 4, name: '#B', depth: 1 },
    ]);
  });

  it('returns an empty list for a category with no children', () => {
    expect(flattenSections(cat({ id: 9, name: 'leaf' }))).toEqual([]);
  });
});

describe('SectionNavigator', () => {
  it('renders nothing when the category has no sub-categories', () => {
    const { container } = render(
      <SectionNavigator
        category={cat({ id: 9, name: 'leaf' })}
        anchorPrefix="subtree-cat"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a fixed floating panel listing all sub-categories by default', () => {
    render(<SectionNavigator category={root} anchorPrefix="subtree-cat" />);

    const panel = screen.getByRole('navigation', { name: /sub-category sections/i });
    // The list is shown by default (no click needed).
    const links = within(panel).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['#A', '#A-sub', '#B']);
    // Anchors use the provided prefix scheme.
    expect(links[0]).toHaveAttribute('href', '#subtree-cat-2');
  });

  it('can collapse and re-expand the section list', async () => {
    const user = userEvent.setup();
    render(<SectionNavigator category={root} anchorPrefix="subtree-cat" />);

    const toggle = screen.getByRole('button', { name: /collapse sections/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    // Links hidden, but the floating panel itself stays mounted.
    expect(screen.queryByRole('link', { name: '#A' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: /sub-category sections/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /expand sections/i }));
    expect(screen.getByRole('link', { name: '#A' })).toBeInTheDocument();
  });

  it('uses the thesaurus anchor scheme when asked', () => {
    render(<SectionNavigator category={root} anchorPrefix="thesaurus-cat" />);
    expect(
      screen.getByRole('link', { name: '#A' }),
    ).toHaveAttribute('href', '#thesaurus-cat-2');
  });

  it('scrolls to the section header on select (panel stays pinned)', async () => {
    const user = userEvent.setup();
    // Provide a target element for the anchor.
    const target = document.createElement('div');
    target.id = 'subtree-cat-4';
    document.body.appendChild(target);

    render(<SectionNavigator category={root} anchorPrefix="subtree-cat" />);
    await user.click(screen.getByRole('link', { name: '#B' }));

    expect(scrollSpy).toHaveBeenCalled();
    // The floating panel remains in place after navigating.
    expect(
      screen.getByRole('navigation', { name: /sub-category sections/i }),
    ).toBeInTheDocument();

    document.body.removeChild(target);
  });

  it('shows an "Add section" control and calls onAddSection when clicked', async () => {
    const user = userEvent.setup();
    const onAddSection = vi.fn();
    render(
      <SectionNavigator
        category={root}
        anchorPrefix="subtree-cat"
        onAddSection={onAddSection}
      />,
    );

    await user.click(screen.getByRole('button', { name: /add section/i }));
    expect(onAddSection).toHaveBeenCalledTimes(1);
  });

  it('shows a per-section edit control and passes the section id', async () => {
    const user = userEvent.setup();
    const onEditSection = vi.fn();
    render(
      <SectionNavigator
        category={root}
        anchorPrefix="subtree-cat"
        onEditSection={onEditSection}
      />,
    );

    await user.click(screen.getByRole('button', { name: /edit #B/i }));
    expect(onEditSection).toHaveBeenCalledWith(4);
  });

  it('still renders the panel (so a section can be added) when there are no sub-categories but an add control exists', () => {
    const onAddSection = vi.fn();
    render(
      <SectionNavigator
        category={cat({ id: 9, name: 'leaf' })}
        anchorPrefix="subtree-cat"
        onAddSection={onAddSection}
      />,
    );

    expect(
      screen.getByRole('navigation', { name: /sub-category sections/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no sub-sections yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add section/i })).toBeInTheDocument();
  });
});
