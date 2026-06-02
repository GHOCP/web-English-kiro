import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CategoryTree } from '@/types';

/**
 * Sidebar component tests (Task 13).
 *
 * Verifies the recursive category tree renders 3+ nesting levels, marks the
 * active node via `aria-current="page"`, exposes accessible branch toggles
 * (`aria-expanded`) that collapse/expand children, and provides the hamburger
 * control for the responsive (< 768px) layout.
 *
 * `next/navigation`'s `usePathname` is mocked so the active highlight is
 * deterministic; the tree is passed via the `categories` prop so no network
 * fetch occurs.
 *
 * Requirements: 1.1, 5.1, 5.2, 5.4, NFR 2.1, NFR 2.2, NFR 2.4
 */

// Mocked pathname — mutated per test to drive the active-node highlight.
let mockPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

import { Sidebar } from './Sidebar';

/** Build a base record with the non-essential Category fields filled in. */
function cat(
  id: number,
  name: string,
  children: CategoryTree = [],
): CategoryTree[number] {
  return {
    id,
    name,
    parentId: null,
    displayOrder: 0,
    viewType: 'list',
    partOfSpeech: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    children,
  };
}

// A 3-level-deep tree: Vocabulary → Thesaurus → Verbs.
const tree: CategoryTree = [
  cat(1, 'Vocabulary', [
    cat(2, 'Thesaurus', [cat(3, 'Verbs'), cat(4, 'Nouns')]),
  ]),
  cat(5, 'Accretion'),
];

beforeEach(() => {
  mockPathname = '/';
});

describe('Sidebar', () => {
  it('renders a nested tree with 3+ levels', () => {
    render(<Sidebar categories={tree} maxDepth={99} />);

    // Level 1, 2, and 3 labels are all present.
    expect(screen.getByRole('link', { name: 'Vocabulary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Thesaurus' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Verbs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nouns' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Accretion' })).toBeInTheDocument();
  });

  it('limits the rendered depth to maxDepth (default 0: top level only)', () => {
    // Default maxDepth=0 shows ONLY top-level categories; every sub-category is
    // surfaced in-content (headers + floating navigator) instead.
    render(<Sidebar categories={tree} />);
    expect(screen.getByRole('link', { name: 'Vocabulary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Accretion' })).toBeInTheDocument();
    // Direct sub-categories are NOT shown.
    expect(
      screen.queryByRole('link', { name: 'Thesaurus' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Verbs' })).not.toBeInTheDocument();

    // A top-level category at the depth cap shows no expand/collapse toggle.
    expect(
      screen.queryByRole('button', { name: /collapse vocabulary/i }),
    ).not.toBeInTheDocument();
  });

  it('points each link at its category route', () => {
    render(<Sidebar categories={tree} maxDepth={99} />);
    expect(screen.getByRole('link', { name: 'Verbs' })).toHaveAttribute(
      'href',
      '/category/3',
    );
  });

  it('marks the active category with aria-current="page"', () => {
    mockPathname = '/category/3';
    render(<Sidebar categories={tree} maxDepth={99} />);

    const active = screen.getByRole('link', { name: 'Verbs' });
    expect(active).toHaveAttribute('aria-current', 'page');

    // Non-active links must not carry aria-current.
    expect(
      screen.getByRole('link', { name: 'Vocabulary' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('exposes an accessible category navigation landmark', () => {
    render(<Sidebar categories={tree} />);
    expect(
      screen.getByRole('navigation', { name: /category navigation/i }),
    ).toBeInTheDocument();
  });

  it('collapses and expands a branch via its accessible toggle', async () => {
    const user = userEvent.setup();
    render(<Sidebar categories={tree} maxDepth={99} />);

    const toggle = screen.getByRole('button', { name: /collapse thesaurus/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Verbs' })).toBeInTheDocument();

    await user.click(toggle);

    // After collapsing, children are removed and the toggle flips state/label.
    expect(
      screen.getByRole('button', { name: /expand thesaurus/i }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Verbs' })).not.toBeInTheDocument();
  });

  it('provides a hamburger toggle for the responsive layout', async () => {
    const user = userEvent.setup();
    render(<Sidebar categories={tree} />);

    const hamburger = screen.getByRole('button', {
      name: /open navigation menu/i,
    });
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');

    await user.click(hamburger);
    expect(
      screen.getByRole('button', { name: /close navigation menu/i }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders an empty-state message when there are no categories', () => {
    render(<Sidebar categories={[]} />);
    expect(screen.getByText(/no categories yet/i)).toBeInTheDocument();
  });

  it('keeps sibling branches independently collapsible', async () => {
    const user = userEvent.setup();
    render(<Sidebar categories={tree} maxDepth={99} />);

    const nav = screen.getByRole('navigation', { name: /category navigation/i });
    // Collapsing the top-level Vocabulary hides its whole subtree.
    await user.click(
      within(nav).getByRole('button', { name: /collapse vocabulary/i }),
    );
    expect(
      screen.queryByRole('link', { name: 'Thesaurus' }),
    ).not.toBeInTheDocument();
    // Accretion (a sibling leaf) is unaffected.
    expect(screen.getByRole('link', { name: 'Accretion' })).toBeInTheDocument();
  });
});
