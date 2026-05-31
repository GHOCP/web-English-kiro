// Writing content view (Task 18, R13).
//
// Renders writing entries — phrases, sentence structures, and expressions —
// grouped and labelled by their distinction so the phrase / structure /
// expression categorisation is preserved and visually distinct (R13.5). Each
// entry shows its pattern/structure text, Chinese translation(s), and example
// sentences, all rendered through the shared sanitizing <Markdown> component
// (R3, R13.2, R13.4).
//
// This is a presentational component: data fetching happens elsewhere (Task 19).
// It accepts a flat list of entries (an `EntryWithRelations[]` is assignable to
// `WritingViewEntry[]`) and performs the grouping internally, keeping it pure
// and trivially testable without a server.
//
// Accessibility (NFR 2.1, 2.4):
//   - one <section> per distinction with an <h2> heading;
//   - entries rendered as a semantic list (<ul>/<li>);
//   - translations grouped in a description list (<dl>).
//
// Requirements: 13.1, 13.3, 13.4, 13.5, 3.2, 3.3, NFR 2.1, NFR 2.4
import { Markdown } from './Markdown';

/** The three writing distinctions preserved by the view (R13.1, R13.5). */
export type WritingDistinction = 'phrase' | 'structure' | 'expression';

/**
 * Minimal structural shape this view reads from an entry. The full
 * `EntryWithRelations` from `@/types` is assignable to it, so callers can pass
 * API results directly while tests can build lightweight fixtures.
 */
export interface WritingViewEntry {
  id: number;
  /** The phrase / sentence-structure / expression pattern text (Markdown). */
  word: string;
  pronunciation?: string | null;
  /** Drives the distinction; one of the writing entry types when set. */
  entryType?: string | null;
  /** Usage context / notes (Markdown). */
  notes?: string | null;
  /** Chinese translation(s) / meaning(s) (Markdown). */
  definitions?: { id?: number; text: string }[];
  /** Example sentences (Markdown). */
  examples?: { id?: number; text: string }[];
  /** Owning category — used as a fallback to derive the distinction. */
  category?: { name?: string | null; viewType?: string | null } | null;
}

export interface WritingViewProps {
  /** Writing entries to render (grouped internally by distinction). */
  entries: WritingViewEntry[];
  /** Optional heading rendered above the grouped sections. */
  title?: string;
}

interface DistinctionMeta {
  /** Section heading label. */
  label: string;
  /** Stable DOM id (used as a TOC anchor and aria-labelledby target). */
  id: string;
  /** Accent class applied to the section heading and entry accents. */
  accentClass: string;
}

/** Fixed render order + presentation metadata for each distinction. */
const DISTINCTIONS: Record<WritingDistinction, DistinctionMeta> = {
  phrase: { label: 'Phrases', id: 'writing-phrases', accentClass: 'text-writing' },
  structure: {
    label: 'Structures',
    id: 'writing-structures',
    accentClass: 'text-writing',
  },
  expression: {
    label: 'Expressions',
    id: 'writing-expressions',
    accentClass: 'text-writing',
  },
};

const DISTINCTION_ORDER: WritingDistinction[] = [
  'phrase',
  'structure',
  'expression',
];

/**
 * Derive an entry's writing distinction.
 *
 * Priority: the entry's own `entryType` when it is a writing type, otherwise a
 * keyword match on the owning category's name / viewType, finally defaulting to
 * `phrase`. Exported for direct unit testing.
 */
export function deriveWritingDistinction(
  entry: WritingViewEntry,
): WritingDistinction {
  const type = entry.entryType?.trim().toLowerCase();
  if (type === 'phrase' || type === 'structure' || type === 'expression') {
    return type;
  }

  const hint = `${entry.category?.name ?? ''} ${
    entry.category?.viewType ?? ''
  }`.toLowerCase();
  if (hint.includes('structure') || hint.includes('struct')) return 'structure';
  if (hint.includes('express')) return 'expression';
  if (hint.includes('phrase')) return 'phrase';

  return 'phrase';
}

function WritingEntryItem({ entry }: { entry: WritingViewEntry }) {
  const definitions = entry.definitions ?? [];
  const examples = entry.examples ?? [];

  return (
    <li
      data-distinction={deriveWritingDistinction(entry)}
      className="rounded-md border border-border bg-surface-elevated p-3"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <div className="font-semibold text-foreground">
          {/* Pattern / structure text, rendered as sanitized Markdown. */}
          <Markdown>{entry.word}</Markdown>
        </div>
        {entry.pronunciation ? (
          <span className="text-sm text-muted">{entry.pronunciation}</span>
        ) : null}
      </div>

      {definitions.length > 0 ? (
        <dl className="mt-1">
          <dt className="sr-only">Translation</dt>
          {definitions.map((def, index) => (
            <dd key={def.id ?? index} className="text-foreground">
              <Markdown>{def.text}</Markdown>
            </dd>
          ))}
        </dl>
      ) : null}

      {examples.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Examples
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
            {examples.map((ex, index) => (
              <li key={ex.id ?? index}>
                <Markdown>{ex.text}</Markdown>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {entry.notes ? (
        <div className="mt-2 text-sm text-muted">
          <Markdown>{entry.notes}</Markdown>
        </div>
      ) : null}
    </li>
  );
}

export function WritingView({ entries, title }: WritingViewProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted">No writing entries yet.</p>
    );
  }

  // Bucket entries by distinction, preserving input order within each bucket.
  const buckets: Record<WritingDistinction, WritingViewEntry[]> = {
    phrase: [],
    structure: [],
    expression: [],
  };
  for (const entry of entries) {
    buckets[deriveWritingDistinction(entry)].push(entry);
  }

  return (
    <div className="space-y-8">
      {title ? (
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
      ) : null}

      {DISTINCTION_ORDER.filter((d) => buckets[d].length > 0).map(
        (distinction) => {
          const meta = DISTINCTIONS[distinction];
          return (
            <section key={distinction} aria-labelledby={meta.id}>
              <h2
                id={meta.id}
                className={`mb-3 border-b border-border pb-1 text-xl font-semibold ${meta.accentClass}`}
              >
                {meta.label}
              </h2>
              <ul className="space-y-3">
                {buckets[distinction].map((entry) => (
                  <WritingEntryItem key={entry.id} entry={entry} />
                ))}
              </ul>
            </section>
          );
        },
      )}
    </div>
  );
}

export default WritingView;
