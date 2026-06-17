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
import { EntryEditor, type CategoryOption } from '@/components/EntryEditor';
import {
  CategoryEditor,
  type EditableCategory,
} from '@/components/CategoryEditor';
import { recordRecentCategory } from '@/lib/recentCategories';
import type { CategoryPageData } from '@/lib/pageData';
import type { CategoryTree, CategoryViewType, CategoryTreeNode } from '@/types';

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

/** Fetch the full category tree (shares the Sidebar's SWR cache key). */
const treeFetcher = (url: string): Promise<CategoryTree> =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Failed to load categories (${res.status})`);
    return res.json() as Promise<CategoryTree>;
  });

/** Locate a node and its parent within a category forest, depth-first. */
function findNodeWithParent(
  forest: readonly CategoryTreeNode[],
  id: number,
  parent: CategoryTreeNode | null = null,
): { node: CategoryTreeNode; parent: CategoryTreeNode | null } | null {
  for (const node of forest) {
    if (node.id === id) return { node, parent };
    const found = findNodeWithParent(node.children, id, node);
    if (found) return found;
  }
  return null;
}

/** Stable ascending sort by `displayOrder` without mutating the input. */
function byDisplayOrder<T extends { displayOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Flatten a category subtree into the list of assignable options for the entry
 * editor's category picker. The root is included at depth 0 (so an entry can
 * still be filed directly under the open category) followed by every
 * descendant sub-category, depth-first in display order and indented by depth.
 */
function buildCategoryOptions(
  category: CategoryPageData['category'],
  depth = 0,
): CategoryOption[] {
  const options: CategoryOption[] = [
    { id: category.id, name: category.name, depth },
  ];
  for (const child of byDisplayOrder(category.children)) {
    options.push(...buildCategoryOptions(child, depth + 1));
  }
  return options;
}

/** Depth-first search for a node by id within a category subtree. */
function findNode(
  node: CategoryTreeNode,
  id: number,
): CategoryTreeNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Collect the ids of `node` and every descendant beneath it. */
function collectSubtreeIds(node: CategoryTreeNode): number[] {
  const ids: number[] = [node.id];
  for (const child of node.children) ids.push(...collectSubtreeIds(child));
  return ids;
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
  // The full tree shares the Sidebar's '/api/categories' SWR cache, so this is
  // effectively free. It lets the section picker offer sibling sections even on
  // a leaf sub-page (where the page category has no children of its own).
  const { data: tree } = useSWR<CategoryTree>('/api/categories', treeFetcher, {
    revalidateOnFocus: false,
  });
  const [creating, setCreating] = useState(false);
  // Section (sub-category) management modals.
  const [addingSection, setAddingSection] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);

  // Record the visit for the recently-viewed-categories cache (R11.4).
  useEffect(() => {
    recordRecentCategory(id);
  }, [id]);

  const pageData = data ?? initialData;
  const anchorPrefix =
    pageData.viewType === 'thesaurus' ? 'thesaurus-cat' : 'subtree-cat';

  // Build the entry editor's section picker options. Prefer the open category's
  // own subtree; but when it is a LEAF (no sub-sections of its own) fall back to
  // its parent's subtree so the owner can still choose among sibling sections
  // (e.g. creating from inside "C" still lets you pick A / B / C … under
  // "N (normal)"). Falls back to the page subtree until the tree loads.
  const located = Array.isArray(tree) ? findNodeWithParent(tree, id) : null;
  const sectionRoot: CategoryTreeNode =
    located && located.node.children.length === 0 && located.parent
      ? located.parent
      : located?.node ?? pageData.category;
  const categoryOptions = buildCategoryOptions(sectionRoot);

  // Revalidate the sidebar tree, this page's data, and entry lists after any
  // category create/edit/delete so every surface reflects the change.
  const refreshAfterCategoryChange = () => {
    void globalMutate(
      (key) => typeof key === 'string' && key.startsWith('/api/categories'),
      undefined,
      { revalidate: true },
    );
    void globalMutate(
      (key) => typeof key === 'string' && key.startsWith('/api/entries'),
      undefined,
      { revalidate: true },
    );
    void mutate();
  };

  // Resolve the category currently being edited (if any) to the editor shape.
  const editingNode =
    editingSectionId !== null
      ? findNode(pageData.category, editingSectionId)
      : null;
  const editingCategory: EditableCategory | null = editingNode
    ? {
        id: editingNode.id,
        name: editingNode.name,
        viewType: editingNode.viewType as CategoryViewType,
        partOfSpeech:
          (editingNode.partOfSpeech as EditableCategory['partOfSpeech']) ?? null,
      }
    : null;

  // Reassignment targets exclude the category being deleted and its subtree.
  const reassignOptions = editingNode
    ? categoryOptions.filter(
        (opt) => !collectSubtreeIds(editingNode).includes(opt.id),
      )
    : [];

  return (
    <div>
      {/* Sections navigator with New entry + section management controls */}
      <SectionNavigator
        category={pageData.category}
        anchorPrefix={anchorPrefix}
        onNewEntry={() => setCreating(true)}
        onAddSection={() => setAddingSection(true)}
        onEditSection={(sectionId) => setEditingSectionId(sectionId)}
      />

      <div className="mb-4 flex items-center justify-between gap-4">
        {pageData.viewType !== 'thesaurus' ? (
          <h1 className="text-2xl font-bold text-foreground">
            {pageData.category.name}
          </h1>
        ) : (
          <span />
        )}
        {/* Mobile actions - shown on small screens since fixed Sections navigator is hidden */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={() => setAddingSection(true)}
            className="shrink-0 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
          >
            New section
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="shrink-0 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
          >
            New entry
          </button>
        </div>
      </div>
      {renderView(pageData)}

      {creating ? (
        <EntryEditor
          categoryId={id}
          categoryOptions={categoryOptions}
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

      {addingSection ? (
        <CategoryEditor
          mode="create"
          defaultParentId={id}
          parentOptions={categoryOptions}
          onClose={() => setAddingSection(false)}
          onSaved={refreshAfterCategoryChange}
        />
      ) : null}

      {editingSectionId !== null && editingCategory ? (
        <CategoryEditor
          mode="edit"
          category={editingCategory}
          reassignOptions={reassignOptions}
          onClose={() => setEditingSectionId(null)}
          onSaved={refreshAfterCategoryChange}
          onDeleted={refreshAfterCategoryChange}
        />
      ) : null}
    </div>
  );
}

export default CategoryView;
