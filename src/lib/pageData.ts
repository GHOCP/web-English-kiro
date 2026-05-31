// Server-side page data loaders for the category / entry routes (Task 19).
//
// These functions assemble exactly the data each page Server Component needs
// for its FIRST PAINT, talking to Prisma / the service layer DIRECTLY rather
// than round-tripping through HTTP (design Q3/Q4 — SSR-first). The same shapes
// are re-used by the SWR client wrappers (the GET `/api/categories/:id` handler
// serves `CategoryPageData` as JSON), so server render and client revalidation
// stay in lock-step.
//
// Responsibilities:
//   - getCategoryPageData: resolve a category to the subtree + entries needed
//     to pick and render the correct view component by `viewType`. For a
//     thesaurus category the whole subtree's entries are grouped by category id
//     (the shape `ThesaurusView` consumes); for the other view types the
//     category's own ordered entries are returned.
//   - getEntryPageData: load a single fully-populated entry (or `null`).
//
// Both take an injected Prisma client so they run against the app singleton in
// production and an isolated test database in tests — no HTTP server required.
//
// Requirements: 11.1 (SSR fast first paint), 11.4 (data for client cache),
// 5.4 (category navigation), 6.3 (entry data behind search results).
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  CategoryTreeNode,
  CategoryViewType,
  EntryWithRelations,
} from '@/types';
import type { EntriesByCategory } from '@/components/ThesaurusView';
import { getCategoryTree } from '@/lib/categories';

/**
 * Everything a `/category/:id` page needs for first paint and client caching.
 */
export interface CategoryPageData {
  /** The category as a subtree node (its `children` hold the nested subtree). */
  category: CategoryTreeNode;
  /** The category's render hint, surfaced for convenient view selection. */
  viewType: CategoryViewType;
  /** The category's own entries, ordered for display (list/genre/writing/…). */
  entries: EntryWithRelations[];
  /**
   * Entries belonging to every category in the subtree, keyed by category id.
   * Consumed by `ThesaurusView`; also a superset of `entries`.
   */
  entriesByCategory: EntriesByCategory;
}

/** Relation include used wherever a fully-populated entry is returned. */
const entryInclude = {
  definitions: { orderBy: { displayOrder: 'asc' } },
  examples: { orderBy: { displayOrder: 'asc' } },
  images: { orderBy: { id: 'asc' } },
  category: true,
} satisfies Prisma.EntryInclude;

/** Depth-first search for a category node within an already-built tree. */
function findNode(
  nodes: CategoryTreeNode[],
  id: number,
): CategoryTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** Collect the ids of `node` and every descendant beneath it. */
function collectSubtreeIds(node: CategoryTreeNode): number[] {
  const ids: number[] = [];
  const stack: CategoryTreeNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop() as CategoryTreeNode;
    ids.push(current.id);
    for (const child of current.children) stack.push(child);
  }
  return ids;
}

/**
 * Load the data backing a `/category/:id` page. Returns `null` when no category
 * with `id` exists (the page maps this to `notFound()`).
 *
 * The full category tree is built once (reusing the tested `getCategoryTree`)
 * and the requested node located within it, so the returned `category` carries
 * its complete nested subtree — exactly what `ThesaurusView` walks. Entries for
 * the whole subtree are fetched in a single query and grouped by category id.
 */
export async function getCategoryPageData(
  prisma: PrismaClient,
  id: number,
): Promise<CategoryPageData | null> {
  const tree = await getCategoryTree(prisma);
  const category = findNode(tree, id);
  if (!category) return null;

  const subtreeIds = collectSubtreeIds(category);

  const allEntries = (await prisma.entry.findMany({
    where: { categoryId: { in: subtreeIds } },
    include: entryInclude,
    orderBy: [{ displayOrder: 'asc' }, { word: 'asc' }],
  })) as EntryWithRelations[];

  const entriesByCategory: EntriesByCategory = {};
  for (const entry of allEntries) {
    (entriesByCategory[entry.categoryId] ??= []).push(entry);
  }

  return {
    category,
    viewType: category.viewType as CategoryViewType,
    entries: entriesByCategory[id] ?? [],
    entriesByCategory,
  };
}

/**
 * Load a single fully-populated entry for an `/entry/:id` page, or `null` when
 * it does not exist (the page maps this to `notFound()`).
 */
export async function getEntryPageData(
  prisma: PrismaClient,
  id: number,
): Promise<EntryWithRelations | null> {
  return prisma.entry.findUnique({
    where: { id },
    include: entryInclude,
  }) as Promise<EntryWithRelations | null>;
}
