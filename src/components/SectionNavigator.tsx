// Floating section navigator (sidebar-flattening change).
//
// The left sidebar now lists ONLY top-level categories. Every sub-category of
// the open category is rendered as an in-content header on the page; this
// component is a floating, fixed "table of contents" pinned to the right edge
// of the viewport that lists those sub-categories and lets the user jump
// between them. It stays in place as the page scrolls.
//
// Selecting a section smooth-scrolls to the matching in-content header, and the
// entry nearest the top of the viewport is highlighted as the user scrolls
// (IntersectionObserver). A small collapse control hides the list (handy on
// narrow screens); the panel is hidden entirely below the md breakpoint where
// horizontal space is scarce.
//
// The anchor ids match the ones the content views stamp on their headers:
//   - ThesaurusView → `thesaurus-cat-<id>`
//   - CategorySubtreeView → `subtree-cat-<id>`
// so a single `anchorPrefix` selects the right scheme per view.
//
// Accessibility:
//   - the panel is a labelled <nav> with an <ol>/<li> list of anchor links;
//   - the active item carries aria-current="location";
//   - the collapse control is a real <button> with aria-expanded.
'use client';

import { useEffect, useState } from 'react';
import type { CategoryTreeNode } from '@/types';

/** A flattened sub-category entry shown in the navigator. */
export interface SectionItem {
  /** Category id (used to build the anchor id). */
  id: number;
  /** Display label. */
  name: string;
  /** Nesting depth relative to the page category (1 = direct child). */
  depth: number;
}

export interface SectionNavigatorProps {
  /** The page's category, whose descendant sub-categories become sections. */
  category: CategoryTreeNode;
  /** Anchor id prefix matching the view that rendered the headers. */
  anchorPrefix: 'thesaurus-cat' | 'subtree-cat';
  /** Optional callback for when "New entry" button is clicked */
  onNewEntry?: () => void;
  /** Optional callback to add a new sub-section. Shows a "+" control. */
  onAddSection?: () => void;
  /** Optional callback to edit a sub-section. Shows a pencil control per row. */
  onEditSection?: (id: number) => void;
}

/** Stable ascending sort by `displayOrder` without mutating the input. */
function byDisplayOrder<T extends { displayOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Flatten a category's descendant sub-categories (depth-first, display order)
 * into a list. The root category itself is excluded — only its sub-categories
 * are navigable sections.
 */
export function flattenSections(
  category: CategoryTreeNode,
  depth = 1,
): SectionItem[] {
  const out: SectionItem[] = [];
  for (const child of byDisplayOrder(category.children)) {
    out.push({ id: child.id, name: child.name, depth });
    out.push(...flattenSections(child, depth + 1));
  }
  return out;
}

export function SectionNavigator({
  category,
  anchorPrefix,
  onNewEntry,
  onAddSection,
  onEditSection,
}: SectionNavigatorProps) {
  const sections = flattenSections(category);
  // The list is shown by default; the collapse control only hides the list,
  // the floating panel itself stays pinned to the viewport.
  const [expanded, setExpanded] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);

  const anchorId = (id: number): string => `${anchorPrefix}-${id}`;

  // Highlight the section nearest the top of the viewport as the user scrolls.
  useEffect(() => {
    if (sections.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const raw = visible[0].target.id.slice(anchorPrefix.length + 1);
          const id = Number(raw);
          if (!Number.isNaN(id)) setActiveId(id);
        }
      },
      { rootMargin: '0px 0px -70% 0px', threshold: [0, 1] },
    );

    for (const section of sections) {
      const el = document.getElementById(anchorId(section.id));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // Re-observe when the section set changes (navigating between categories).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category.id, sections.length, anchorPrefix]);

  function handleSelect(id: number) {
    const el = document.getElementById(anchorId(id));
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
    }
  }

  // Nothing to navigate AND nothing to do → render nothing. When an add/entry
  // control is available we still show the panel so the owner can act (e.g.
  // create the first sub-section).
  if (sections.length === 0 && !onAddSection && !onNewEntry) return null;

  return (
    <nav
      aria-label="Sub-category sections"
      // Fixed to the right edge, vertically centered, and hidden on small
      // screens (no room beside the content). It floats above the content and
      // stays put while the page scrolls — like a table of contents.
      className="fixed right-4 top-24 z-30 hidden max-h-[70vh] w-60 flex-col rounded-lg border border-border bg-surface-elevated/95 shadow-lg backdrop-blur md:flex"
    >
      {/* New entry button at the top if callback is provided */}
      {onNewEntry && (
        <div className="border-b border-border p-3">
          <button
            type="button"
            onClick={onNewEntry}
            className="w-full rounded-md bg-writing px-3 py-2 text-sm font-medium text-white hover:bg-writing/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
          >
            New entry
          </button>
        </div>
      )}
      
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Sections
        </p>
        <div className="flex items-center gap-1">
          {onAddSection ? (
            <button
              type="button"
              onClick={onAddSection}
              aria-label="Add section"
              title="Add section"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
            >
              <span aria-hidden="true">＋</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-controls="section-navigator-list"
            aria-label={expanded ? 'Collapse sections' : 'Expand sections'}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
          >
            <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          </button>
        </div>
      </div>

      {expanded ? (
        sections.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">No sub-sections yet.</p>
        ) : (
          <ol
            id="section-navigator-list"
            className="space-y-0.5 overflow-auto p-2"
          >
            {sections.map((section) => {
              const isActive = section.id === activeId;
              return (
                <li key={section.id} className="flex items-center gap-1">
                  <a
                    href={`#${anchorId(section.id)}`}
                    aria-current={isActive ? 'location' : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      handleSelect(section.id);
                    }}
                    style={{ paddingLeft: `${(section.depth - 1) * 12 + 8}px` }}
                    className={[
                      'block min-w-0 flex-1 truncate rounded px-2 py-1 text-sm transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-writing',
                      isActive
                        ? 'bg-writing/10 font-semibold text-writing'
                        : 'text-foreground hover:bg-surface',
                    ].join(' ')}
                    title={section.name}
                  >
                    {section.name}
                  </a>
                  {onEditSection ? (
                    <button
                      type="button"
                      onClick={() => onEditSection(section.id)}
                      aria-label={`Edit ${section.name}`}
                      title={`Edit ${section.name}`}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                    >
                      <span aria-hidden="true">✎</span>
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )
      ) : null}
    </nav>
  );
}

export default SectionNavigator;
