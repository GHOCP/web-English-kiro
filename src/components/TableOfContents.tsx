// Sticky table of contents (Task 13, R5.3 + R5.5).
//
// Renders a sticky list of the current page's section headings and highlights
// the one currently in view using an IntersectionObserver — replacing the
// legacy scroll-position math. Sections are passed in as props (id + label) so
// the component is pure and easy to test; the observer is the only side effect.
//
// Clicking an item scrolls to the matching section via its anchor; the
// highlighted item is also marked with `aria-current="location"` for AT users.
//
// Accessibility (NFR 2.1, 2.2, 2.4):
//   - semantic <nav aria-label> + <ol>/<li> structure;
//   - anchor links are keyboard operable;
//   - the active item carries `aria-current`.
//
// Requirements: 5.3, 5.5, NFR 2.1, NFR 2.2, NFR 2.4
'use client';

import { useEffect, useState } from 'react';

export interface TocSection {
  /** The DOM id of the section heading/element this entry links to. */
  id: string;
  /** Human-readable label shown in the TOC. */
  label: string;
}

export interface TableOfContentsProps {
  /** Ordered list of sections to list. */
  sections: TocSection[];
  /**
   * IntersectionObserver rootMargin. The default biases detection toward the
   * top of the viewport so a section is "active" as its heading nears the top.
   */
  rootMargin?: string;
}

export function TableOfContents({
  sections,
  rootMargin = '0px 0px -70% 0px',
}: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string | null>(
    sections[0]?.id ?? null,
  );

  useEffect(() => {
    if (sections.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Prefer the topmost intersecting section so the highlight tracks the
        // heading nearest the top of the viewport as the user scrolls.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top,
          );

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin, threshold: [0, 1] },
    );

    const observed: Element[] = [];
    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) {
        observer.observe(el);
        observed.push(el);
      }
    }

    return () => observer.disconnect();
  }, [sections, rootMargin]);

  if (sections.length === 0) return null;

  return (
    <nav
      aria-label="Table of contents"
      className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-auto"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        On this page
      </p>
      <ol className="space-y-1">
        {sections.map((section) => {
          const isActive = section.id === activeId;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={isActive ? 'location' : undefined}
                className={[
                  'block rounded px-2 py-1 text-sm transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-writing',
                  isActive
                    ? 'font-semibold text-writing'
                    : 'text-muted hover:text-foreground',
                ].join(' ')}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default TableOfContents;
