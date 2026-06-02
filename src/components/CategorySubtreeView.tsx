// Subtree content renderer (sidebar-flattening change).
//
// The sidebar now shows only the top-level categories and their DIRECT
// sub-categories (see `Sidebar`'s `maxDepth`). Any deeper sub-category is no
// longer a nav link, so the category page must surface those deeper
// sub-categories itself — as in-content headers — otherwise their entries would
// be unreachable.
//
// This component walks a category subtree depth-first and renders:
//   - each descendant sub-category as a heading (h2 → h3 → h4 by depth), and
//   - that category's own entries beneath its heading, using a leaf renderer
//     chosen by the page's `viewType` (list / genre / writing / speaking).
//
// The root category's own entries (depth 0) render directly, with no extra
// heading, because the page already shows the category title. Thesaurus pages
// keep their dedicated `ThesaurusView` (which already renders its subtree as
// headers + word|pronunciation|definition tables), so this component covers the
// other four view types.
//
// Presentational only — all data is passed in (the SSR/SWR layer supplies the
// subtree + `entriesByCategory`), so it is server-free and easy to test.
import Link from 'next/link';
import { Markdown } from '@/components/Markdown';
import { thumbnailUrl } from '@/components/GenreGridView';
import { splitDialogueLines } from '@/components/SpeakingView';
import type {
  CategoryTreeNode,
  CategoryViewType,
  EntryWithRelations,
} from '@/types';
import type { EntriesByCategory } from '@/components/ThesaurusView';

export interface CategorySubtreeViewProps {
  /** The category to render, with its full nested subtree in `children`. */
  category: CategoryTreeNode;
  /** Entries for every category in the subtree, keyed by category id. */
  entriesByCategory: EntriesByCategory;
  /** The page's view type, which selects the per-category leaf renderer. */
  viewType: CategoryViewType;
}

/** Stable ascending sort by `displayOrder` without mutating the input. */
function byDisplayOrder<T extends { displayOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Heading element for a given subtree depth (depth 1 = h2), capped at h4. */
function headingTag(depth: number): 'h2' | 'h3' | 'h4' {
  if (depth <= 1) return 'h2';
  if (depth === 2) return 'h3';
  return 'h4';
}

/** Genre leaf: a dense, non-virtualized grid of word | meaning | thumbnail. */
function GenreLeaf({ entries }: { entries: EntryWithRelations[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => {
        const meaning = entry.definitions[0]?.text ?? '';
        const image = entry.images[0];
        return (
          <article
            key={entry.id}
            aria-label={entry.word}
            className="flex gap-3 rounded-md border border-border bg-surface p-3"
          >
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold text-foreground">
                <Link
                  href={`/entry/${entry.id}`}
                  className="underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                >
                  {entry.word}
                </Link>
              </h4>
              {entry.pronunciation ? (
                <p className="text-xs text-muted">{entry.pronunciation}</p>
              ) : null}
              {meaning ? (
                <Markdown className="mt-1 text-sm text-foreground/90">
                  {meaning}
                </Markdown>
              ) : null}
            </div>
            {image ? (
              <img
                src={thumbnailUrl(image.id)}
                alt={image.altText?.trim() ? image.altText : entry.word}
                width={80}
                height={80}
                loading="lazy"
                className="h-20 w-20 shrink-0 rounded object-cover"
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

/**
 * Default "list" rendering: a 3-column table (Word | Pronunciation | Meaning),
 * one entry per row, mirroring the thesaurus table style. The word links to its
 * detail page and the meaning (first definition) renders as sanitized Markdown.
 */
function ListLeaf({ entries }: { entries: EntryWithRelations[] }) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
          <th scope="col" className="py-1.5 pr-4 font-semibold">
            Word
          </th>
          <th scope="col" className="py-1.5 pr-4 font-semibold">
            Pronunciation
          </th>
          <th scope="col" className="py-1.5 font-semibold">
            Meaning
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const meaning = entry.definitions[0]?.text;
          return (
            <tr key={entry.id} className="border-b border-border/60 align-top">
              <th scope="row" className="py-2 pr-4 font-medium">
                <Link
                  href={`/entry/${entry.id}`}
                  lang="en"
                  className="text-writing underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                >
                  {entry.word}
                </Link>
              </th>
              <td className="py-2 pr-4 text-muted">{entry.pronunciation ?? ''}</td>
              <td className="py-2">
                {meaning ? (
                  <Markdown className="max-w-none">{meaning}</Markdown>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Writing leaf: pattern text, translation(s), and example sentences. */
function WritingLeaf({ entries }: { entries: EntryWithRelations[] }) {
  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li
          key={entry.id}
          data-entry-type={entry.entryType ?? 'phrase'}
          className="rounded-md border border-border bg-surface-elevated p-3"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <Link
              href={`/entry/${entry.id}`}
              className="font-semibold text-foreground underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
            >
              <Markdown>{entry.word}</Markdown>
            </Link>
            {entry.pronunciation ? (
              <span className="text-sm text-muted">{entry.pronunciation}</span>
            ) : null}
          </div>
          {entry.definitions.length > 0 ? (
            <dl className="mt-1">
              <dt className="sr-only">Translation</dt>
              {entry.definitions.map((def) => (
                <dd key={def.id} className="text-foreground">
                  <Markdown>{def.text}</Markdown>
                </dd>
              ))}
            </dl>
          ) : null}
          {entry.examples.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
              {entry.examples.map((ex) => (
                <li key={ex.id}>
                  <Markdown>{ex.text}</Markdown>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Speaking leaf: each entry rendered as a turn-by-turn dialogue block. */
function SpeakingLeaf({ entries }: { entries: EntryWithRelations[] }) {
  return (
    <ul className="space-y-3">
      {entries.map((entry) => {
        const lines = splitDialogueLines(entry.word);
        return (
          <li
            key={entry.id}
            className="rounded-md border border-border bg-surface-elevated p-3"
          >
            <ol className="space-y-1" aria-label="Dialogue">
              {lines.map((line, index) => (
                <li key={index} className="flex gap-2 text-foreground">
                  <span aria-hidden="true" className="select-none text-speaking">
                    –
                  </span>
                  <div className="flex-1">
                    <Markdown>{line}</Markdown>
                  </div>
                </li>
              ))}
            </ol>
            {entry.definitions.length > 0 ? (
              <dl className="mt-2 border-t border-border pt-2">
                <dt className="sr-only">Translation</dt>
                {entry.definitions.map((def) => (
                  <dd key={def.id} className="text-sm text-muted">
                    <Markdown>{def.text}</Markdown>
                  </dd>
                ))}
              </dl>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Render a single category's own entries with the view-appropriate leaf. */
function Leaf({
  entries,
  viewType,
}: {
  entries: EntryWithRelations[];
  viewType: CategoryViewType;
}) {
  if (entries.length === 0) return null;
  switch (viewType) {
    case 'genre':
      return <GenreLeaf entries={entries} />;
    case 'writing':
      return <WritingLeaf entries={entries} />;
    case 'speaking':
      return <SpeakingLeaf entries={entries} />;
    case 'list':
    default:
      return <ListLeaf entries={entries} />;
  }
}

interface SubtreeNodeProps {
  node: CategoryTreeNode;
  entriesByCategory: EntriesByCategory;
  viewType: CategoryViewType;
  depth: number;
}

/** Render one category node: heading (for descendants), entries, then children. */
function SubtreeNode({
  node,
  entriesByCategory,
  viewType,
  depth,
}: SubtreeNodeProps) {
  const entries = byDisplayOrder(entriesByCategory[node.id] ?? []);
  const children = byDisplayOrder(node.children);
  const Heading = headingTag(depth);
  const headingId = `subtree-cat-${node.id}`;

  return (
    <section
      aria-labelledby={depth > 0 ? headingId : undefined}
      className={depth > 0 ? 'mt-6' : ''}
    >
      {depth > 0 ? (
        <Heading
          id={headingId}
          className={
            depth === 1
              ? 'border-b border-border pb-1 text-xl font-semibold text-foreground'
              : 'mt-2 text-base font-semibold text-foreground'
          }
        >
          <Link
            href={`/category/${node.id}`}
            className="text-foreground underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
          >
            {node.name}
          </Link>
        </Heading>
      ) : null}

      <div className={depth > 0 ? 'mt-2' : ''}>
        <Leaf entries={entries} viewType={viewType} />
      </div>

      {children.map((child) => (
        <SubtreeNode
          key={child.id}
          node={child}
          entriesByCategory={entriesByCategory}
          viewType={viewType}
          depth={depth + 1}
        />
      ))}
    </section>
  );
}

export function CategorySubtreeView({
  category,
  entriesByCategory,
  viewType,
}: CategorySubtreeViewProps) {
  const hasAny =
    Object.values(entriesByCategory).some((list) => list.length > 0) ||
    category.children.length > 0;

  if (!hasAny) {
    return <p className="text-sm text-muted">No entries in this category yet.</p>;
  }

  return (
    <CategorySubtreeRoot
      category={category}
      entriesByCategory={entriesByCategory}
      viewType={viewType}
    />
  );
}

/** Internal root wrapper kept separate so the public component stays lean. */
function CategorySubtreeRoot({
  category,
  entriesByCategory,
  viewType,
}: CategorySubtreeViewProps) {
  return (
    <SubtreeNode
      node={category}
      entriesByCategory={entriesByCategory}
      viewType={viewType}
      depth={0}
    />
  );
}

export default CategorySubtreeView;
