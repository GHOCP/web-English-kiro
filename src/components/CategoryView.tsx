// Client-side category view wrapper (Task 19, R11.1/R11.4/R11.5, R5.4).
//
// This is the interactivity layer for a `/category/:id` page. The page Server
// Component fetches `CategoryPageData` directly from the database for a fast
// first paint (SSR, R11.1) and passes it here as `initialData`. This component
// then:
//
//   - hydrates SWR with that data via `fallbackData`, keyed by
//     `/api/categories/:id`, so revisiting a category is instant and served
//     from the client cache, with background revalidation (R11.4, design Q3);
//   - records the visit in the recently-viewed cache (R11.4);
//   - selects the correct read view by the category's `viewType`
//     (thesaurus / genre / writing / speaking / default list).
//
// Because navigation between categories uses the App Router `<Link>` elements
// in the Sidebar and within these views, moving category-to-category never does
// a full page reload (R11.5).
//
// Requirements: 11.1, 11.4, 11.5, 5.4
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';

import { ThesaurusView } from '@/components/ThesaurusView';
import { CategorySubtreeView } from '@/components/CategorySubtreeView';
import { SectionNavigator } from '@/components/SectionNavigator';
import { EntryEditor } from '@/components/EntryEditor';
import { Markdown } from '@/components/Markdown';
import { recordRecentCategory } from '@/lib/recentCategories';
import type { CategoryPageData } from '@/lib/pageData';
import type { EntryWithRelations } from '@/types';

export interface CategoryViewProps {
  /** Category id (the route param). */
  id: number;
  /** SSR-fetched page data used to hydrate SWR for an instant first paint. */
  initialData: CategoryPageData;
}

/** SWR key for a category's page data. */
export function categoryDataKey(id: number): string {
  return `/api/categories/${id}`;
}

const fetcher = (url: string): Promise<CategoryPageData> =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Failed to load category (${res.status})`);
    return res.json() as Promise<CategoryPageData>;
  });

/** Pick and render the view component matching the category's `viewType`. */
function renderView(data: CategoryPageData) {
  switch (data.viewType) {
    case 'thesaurus':
      return (
        <ThesaurusView
          category={data.category}
          entriesByCategory={data.entriesByCategory}
        />
      );
    // list / genre / writing / speaking all render the FULL subtree, surfacing
    // deeper sub-categories (no longer in the sidebar) as in-content headers.
    case 'genre':
    case 'writing':
    case 'speaking':
    case 'list':
    default:
      return (
        <CategorySubtreeView
          category={data.category}
          entriesByCategory={data.entriesByCategory}
          viewType={data.viewType}
        />
      );
  }
}

export function CategoryView({ id, initialData }: CategoryViewProps) {
  // SWR hydrates from the SSR data (fallbackData) and revalidates in the
  // background, so the cache is warm immediately and re-visits are instant.
  const { data, mutate } = useSWR<CategoryPageData>(categoryDataKey(id), fetcher, {
    fallbackData: initialData,
    revalidateOnFocus: false,
  });
  const { mutate: globalMutate } = useSWRConfig();
  const [creating, setCreating] = useState(false);

  // Record the visit for the recently-viewed-categories cache (R11.4).
  useEffect(() => {
    recordRecentCategory(id);
  }, [id]);

  const pageData = data ?? initialData;
  const anchorPrefix =
    pageData.viewType === 'thesaurus' ? 'thesaurus-cat' : 'subtree-cat';

  return (
    <div>
      {/* Sections navigator with New entry button */}
      <SectionNavigator
        category={pageData.category}
        anchorPrefix={anchorPrefix}
        onNewEntry={() => setCreating(true)}
      />

      <div className="mb-4 flex items-center justify-between gap-4">
        {pageData.viewType !== 'thesaurus' ? (
          <h1 className="text-2xl font-bold text-foreground">
            {pageData.category.name}
          </h1>
        ) : (
          <span />
        )}
        {/* Mobile "New entry" button - shown on small screens since fixed Sections navigator is hidden */}
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-writing md:hidden"
        >
          New entry
        </button>
      </div>
      {renderView(pageData)}

      {creating ? (
        <EntryEditor
          categoryId={id}
          onClose={() => setCreating(false)}
          onSaved={() => {
            // Refresh this category's page data and any /api/entries caches so
            // the new entry shows up without a full page reload (R11.4).
            void mutate();
            void globalMutate(
              (key) => typeof key === 'string' && key.startsWith('/api/entries'),
              undefined,
              { revalidate: true },
            );
          }}
        />
      ) : null}
    </div>
  );
}

export default CategoryView;
