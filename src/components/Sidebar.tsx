// Responsive category sidebar (Task 13, R1 + R5).
//
// Renders the category tree recursively (supports 3+ nesting levels), highlights
// the active category using the current pathname, and collapses to a hamburger
// menu below 768px. Each branch with children is independently expandable via a
// keyboard-accessible toggle.
//
// Data: by default the tree is fetched client-side with SWR from
// `GET /api/categories`, giving instant re-renders and client caching (R11.4).
// A `categories` prop may be supplied instead (e.g. from a Server Component or
// a test), in which case no fetch occurs — keeping the component easy to test.
//
// Accessibility (NFR 2.1, 2.2, 2.4):
//   - semantic <nav>/<ul>/<li> structure;
//   - `aria-current="page"` on the active link;
//   - `aria-expanded` on branch toggles, `aria-label` on the nav + hamburger;
//   - everything reachable and operable by keyboard.
//
// Requirements: 1.1, 5.1, 5.2, 5.4, NFR 2.1, NFR 2.2, NFR 2.4
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import useSWR from 'swr';
import type { CategoryTree, CategoryTreeNode } from '@/types';

export interface SidebarProps {
  /**
   * Pre-fetched category tree. When provided the sidebar renders it directly
   * and does NOT fetch (useful for Server Components and tests). When omitted
   * the tree is loaded client-side via SWR.
   */
  categories?: CategoryTree;
  /**
   * Deepest nesting level the sidebar renders (0 = top level only). Defaults to
   * 0, so the nav shows ONLY top-level categories; every sub-category is
   * surfaced on the category page instead — as in-content headers plus a
   * floating section navigator (see `SectionNavigator`).
   */
  maxDepth?: number;
}

const fetcher = (url: string): Promise<CategoryTree> =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Failed to load categories (${res.status})`);
    return res.json() as Promise<CategoryTree>;
  });

/**
 * Map a top-level category to its accent text colour. The legacy identity is
 * red Vocabulary / purple Accretion / green Speaking / blue Writing; unknown
 * names fall back to the sidebar foreground colour.
 */
function topLevelAccentClass(name: string): string {
  switch (name.trim().toLowerCase()) {
    case 'vocabulary':
      return 'text-vocabulary';
    case 'accretion':
      return 'text-accretion';
    case 'speaking':
      return 'text-speaking';
    case 'writing':
      return 'text-writing';
    default:
      return 'text-sidebar-foreground';
  }
}

interface SidebarNodeProps {
  node: CategoryTreeNode;
  /** Nesting depth (0 = top level) — drives indentation and accent colour. */
  depth: number;
  /**
   * Deepest depth the sidebar renders. Nodes at `maxDepth` are shown as plain
   * links with no expand toggle and no children, even when the underlying
   * category has descendants — those deeper sub-categories are surfaced as
   * in-content headers on the category page instead.
   */
  maxDepth: number;
  /** The active category path (e.g. `/category/5`) for highlight comparison. */
  activePath: string | null;
}

function SidebarNode({ node, depth, maxDepth, activePath }: SidebarNodeProps) {
  const href = `/category/${node.id}`;
  const isActive = activePath === href;
  // Only branch (show children + toggle) while we are above the depth cap.
  const showChildren = node.children.length > 0 && depth < maxDepth;
  const [expanded, setExpanded] = useState(true);

  const accentClass = depth === 0 ? topLevelAccentClass(node.name) : '';

  return (
    <li>
      <div
        className="flex items-center gap-1"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {showChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-label={
              expanded ? `Collapse ${node.name}` : `Expand ${node.name}`
            }
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-sidebar-foreground/70 hover:text-sidebar-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span className="inline-block h-5 w-5 shrink-0" aria-hidden="true" />
        )}

        <Link
          href={href}
          aria-current={isActive ? 'page' : undefined}
          className={[
            'flex-1 rounded px-2 py-1 text-sm transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-writing',
            depth === 0 ? `font-semibold ${accentClass}` : 'text-sidebar-foreground',
            isActive
              ? 'bg-sidebar-foreground/15 font-semibold'
              : 'hover:bg-sidebar-foreground/10',
          ].join(' ')}
        >
          {node.name}
        </Link>
      </div>

      {showChildren && expanded && (
        <ul>
          {node.children.map((child) => (
            <SidebarNode
              key={child.id}
              node={child}
              depth={depth + 1}
              maxDepth={maxDepth}
              activePath={activePath}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Sidebar({ categories, maxDepth = 0 }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Only fetch when no tree was supplied. SWR keys are null-safe: passing a
  // null key disables the request entirely.
  const { data, error, isLoading } = useSWR<CategoryTree>(
    categories ? null : '/api/categories',
    fetcher,
  );

  const tree: CategoryTree = categories ?? data ?? [];

  return (
    <>
      {/* Hamburger — visible only below the 768px (md) breakpoint (R5.2). */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="sidebar-nav"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-writing md:hidden"
      >
        <span aria-hidden="true">{open ? '✕' : '☰'}</span>
      </button>

      <nav
        id="sidebar-nav"
        aria-label="Category navigation"
        className={[
          'bg-sidebar text-sidebar-foreground md:block md:w-64 md:shrink-0',
          // On md+ the sidebar is its own full-height scroll container, so a
          // long category list scrolls independently of the content area.
          'md:h-screen md:overflow-y-auto',
          // Below md: shown only when toggled open; full-bleed panel.
          open ? 'block' : 'hidden',
        ].join(' ')}
      >
        <div className="p-3">
          {error ? (
            <p role="alert" className="px-2 py-1 text-sm text-vocabulary">
              Could not load categories.
            </p>
          ) : isLoading && tree.length === 0 ? (
            <p className="px-2 py-1 text-sm text-sidebar-foreground/70">
              Loading…
            </p>
          ) : tree.length === 0 ? (
            <p className="px-2 py-1 text-sm text-sidebar-foreground/70">
              No categories yet.
            </p>
          ) : (
            <ul>
              {tree.map((node) => (
                <SidebarNode
                  key={node.id}
                  node={node}
                  depth={0}
                  maxDepth={maxDepth}
                  activePath={pathname}
                />
              ))}
            </ul>
          )}
        </div>
      </nav>
    </>
  );
}

export default Sidebar;
