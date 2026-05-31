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
import { GenreGridView, type GenreEntry } from '@/components/GenreGridView';
import { WritingView } from '@/components/WritingView';
import { SpeakingView } from '@/components/SpeakingView';
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

/** Map an `EntryWithRelations` to the lean shape `GenreGridView` consumes. */
function toGenreEntry(entry: EntryWithRelations): GenreEntry {
  return {
    id: entry.id,
    word: entry.word,
    pronunciation: entry.pronunciation,
    definitions: entry.definitions.map((d) => ({ id: d.id, text: d.text })),
    images: entry.images.map((img) => ({ id: img.id, altText: img.altText })),
  };
}

/**
 * Default "list" rendering: a readable list of entries, each linking to its
 * detail page (`/entry/:id`) with the first definition as an inline preview.
 */
function EntryList({ entries }: { entries: EntryWithRelations[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No entries in this category yet.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {entries.map((entry) => {
        const preview = entry.definitions[0]?.text;
        return (
          <li key={entry.id} className="py-3">
            <Link
              href={`/entry/${entry.id}`}
              className="font-semibold text-writing underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
              lang="en"
            >
              {entry.word}
            </Link>
            {entry.pronunciation ? (
              <span className="ml-2 text-sm text-muted">
                {entry.pronunciation}
              </span>
            ) : null}
            {preview ? (
              <Markdown className="mt-1 text-sm text-foreground/90">
                {preview}
              </Markdown>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

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
    case 'genre':
      return <GenreGridView entries={data.entries.map(toGenreEntry)} />;
    case 'writing':
      return <WritingView entries={data.entries} title={data.category.name} />;
    case 'speaking':
      return <SpeakingView entries={data.entries} title={data.category.name} />;
    case 'list':
    default:
      return <EntryList entries={data.entries} />;
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        {pageData.viewType !== 'thesaurus' &&
        pageData.viewType !== 'writing' &&
        pageData.viewType !== 'speaking' ? (
          <h1 className="text-2xl font-bold text-foreground">
            {pageData.category.name}
          </h1>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
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
