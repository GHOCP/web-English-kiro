// Thesaurus group view (Task 16, R9.2 + R9.3 + R9.4 + R9.5 + R3.3).
//
// Renders a thesaurus category subtree — a `CategoryTreeNode` whose
// `viewType === "thesaurus"` — as the classic thesaurus layout:
//
//   part-of-speech section (Verb / Noun / Adjective / Collection)
//     → semantic-label sub-category (e.g. "刺激。激发")
//         → table of:  word | pronunciation | definition
//
// The structure is modeled purely with the Category tree (design Q12): there is
// no separate group entity. A part-of-speech category carries `partOfSpeech`;
// its child categories are the semantic labels; an entry belongs to a group via
// its `categoryId`. This component walks that tree recursively, so it works
// whether it is handed the whole thesaurus root or just a single
// part-of-speech / semantic-label subtree.
//
// Data is passed in (presentational; fetching is Task 19): the subtree as a
// `CategoryTreeNode` plus a lookup of the entries that belong to each category
// id. This keeps the component server-free and trivially testable.
//
// Linking (R9.5): each semantic-label group heading links to that group's full
// category view (`/category/:id`), and every word in a table links to its entry
// detail page (`/entry/:id`).
//
// All definition cells are rendered through the shared <Markdown> component so
// stored Markdown is shown safely, never as raw HTML (R3.3, NFR 4.1).
//
// Accessibility (NFR 2.1, NFR 2.4): semantic <section> + headings per level and
// real <table> markup with `<thead>` and `<th scope="col">` column headers.
//
// Requirements: 2.5, 9.2, 9.3, 9.5, 3.3
import Link from 'next/link';
import { Markdown } from './Markdown';
import type {
  CategoryTreeNode,
  EntryWithRelations,
  Definition,
} from '@/types';

/** A lookup of the entries belonging to a category, keyed by category id. */
export type EntriesByCategory = Record<number, EntryWithRelations[]>;

export interface ThesaurusViewProps {
  /**
   * The thesaurus subtree to render. Typically a category with
   * `viewType === "thesaurus"`; its `children` hold the part-of-speech and/or
   * semantic-label sub-categories.
   */
  category: CategoryTreeNode;
  /** Entries grouped by their owning category id. */
  entriesByCategory: EntriesByCategory;
}

/** Map a category's stored `partOfSpeech` code to a readable section label. */
function partOfSpeechLabel(pos: string | null | undefined): string | null {
  switch (pos) {
    case 'V':
      return 'Verbs';
    case 'N':
      return 'Nouns';
    case 'ADJ':
      return 'Adjectives';
    case 'Collection':
      return 'Collections';
    default:
      return null;
  }
}

/** Stable ascending sort by `displayOrder` without mutating the input. */
function byDisplayOrder<T extends { displayOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder);
}

/** First definition (by display order) used as the table's definition cell. */
function primaryDefinition(entry: EntryWithRelations): Definition | undefined {
  return byDisplayOrder(entry.definitions)[0];
}

/** Heading tag for a given nesting depth, capped at <h4>. */
function headingTag(depth: number): 'h2' | 'h3' | 'h4' {
  if (depth <= 0) return 'h2';
  if (depth === 1) return 'h3';
  return 'h4';
}

interface GroupTableProps {
  entries: EntryWithRelations[];
  /** Used for an accessible caption / label association. */
  labelId: string;
}

/** The word | pronunciation | definition grid for one semantic-label group. */
function GroupTable({ entries, labelId }: GroupTableProps) {
  const ordered = byDisplayOrder(entries);
  
  // For Thesaurus, use 2-column grid (2 entries per row)
  return (
    <div
      aria-labelledby={labelId}
      className="mt-2"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ordered.map((entry) => {
          const definition = primaryDefinition(entry);
          return (
            <article
              key={entry.id}
              className="rounded-md border border-border bg-surface p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h5 className="font-medium text-foreground">
                  <Link
                    href={`/entry/${entry.id}`}
                    lang="en"
                    className="text-writing underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                  >
                    {entry.word}
                  </Link>
                </h5>
                {entry.pronunciation ? (
                  <span className="text-sm text-muted">{entry.pronunciation}</span>
                ) : null}
              </div>
              {definition ? (
                <div className="mt-1">
                  <Markdown className="text-sm text-foreground/90">{definition.text}</Markdown>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

interface ThesaurusNodeProps {
  node: CategoryTreeNode;
  entriesByCategory: EntriesByCategory;
  depth: number;
}

/**
 * Render one category node: its heading, an entry table if it directly owns
 * entries, and its child sub-categories recursively.
 */
function ThesaurusNode({ node, entriesByCategory, depth }: ThesaurusNodeProps) {
  const Heading = headingTag(depth);
  const headingId = `thesaurus-cat-${node.id}`;
  const posLabel = partOfSpeechLabel(node.partOfSpeech);
  const entries = entriesByCategory[node.id] ?? [];
  const children = byDisplayOrder(node.children);
  const isGroup = entries.length > 0;

  return (
    <section aria-labelledby={headingId} className={depth === 0 ? '' : 'mt-4'}>
      <Heading
        id={headingId}
        className={
          depth === 0
            ? 'text-2xl font-bold tracking-tight text-foreground'
            : depth === 1
              ? 'text-lg font-semibold text-foreground'
              : 'text-base font-semibold text-foreground'
        }
      >
        {/* A group that owns entries links to its full group view (R9.5);
            structural part-of-speech sections are plain headings. */}
        {isGroup ? (
          <Link
            href={`/category/${node.id}`}
            className="text-foreground underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
          >
            {node.name}
          </Link>
        ) : (
          node.name
        )}
        {posLabel ? (
          <span className="ml-2 align-middle text-xs font-medium uppercase tracking-wide text-muted">
            {posLabel}
          </span>
        ) : null}
      </Heading>

      {isGroup ? <GroupTable entries={entries} labelId={headingId} /> : null}

      {children.map((child) => (
        <ThesaurusNode
          key={child.id}
          node={child}
          entriesByCategory={entriesByCategory}
          depth={depth + 1}
        />
      ))}
    </section>
  );
}

export function ThesaurusView({
  category,
  entriesByCategory,
}: ThesaurusViewProps) {
  return (
    <div className="mx-auto max-w-4xl text-foreground">
      <ThesaurusNode
        node={category}
        entriesByCategory={entriesByCategory}
        depth={0}
      />
    </div>
  );
}

export default ThesaurusView;
