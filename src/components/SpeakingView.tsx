// Speaking content view (Task 18, R14).
//
// Formats speaking entries — scene dialogues and daily phrases — in a readable
// conversational layout (R14.4). Entries are grouped by their situation type
// (R14.3): the situation/scene is taken from each entry's owning category name
// (e.g. "Shopping", "Christmas"), falling back to a single "Phrases" group.
//
// Each entry is rendered as a dialogue block. Dialogue lines (the source uses
// "-- " turn markers and line breaks) are split into individual conversational
// lines so the exchange reads turn-by-turn, with the Chinese translation and
// any usage notes shown alongside. All free text renders through the shared
// sanitizing <Markdown> component (R3, R14.2).
//
// This is a presentational component: data fetching happens elsewhere (Task 19).
// `EntryWithRelations[]` is assignable to `SpeakingViewEntry[]`, so API results
// can be passed directly while tests build lightweight fixtures.
//
// Accessibility (NFR 2.1, 2.4):
//   - one <section> per situation with an <h2> heading;
//   - dialogues rendered as ordered lists of turns;
//   - translations grouped in a description list (<dl>).
//
// Requirements: 14.1, 14.3, 14.4, 3.2, 3.3, NFR 2.1, NFR 2.4
import { Markdown } from './Markdown';

/**
 * Minimal structural shape this view reads from an entry. The full
 * `EntryWithRelations` from `@/types` is assignable to it.
 */
export interface SpeakingViewEntry {
  id: number;
  /** Dialogue or phrase text (Markdown; may contain multiple turns). */
  word: string;
  /** Chinese translation(s) (Markdown). */
  definitions?: { id?: number; text: string }[];
  /** Usage notes (Markdown). */
  notes?: string | null;
  /** Owning category — its name is used as the situation/scene grouping. */
  category?: { id?: number; name?: string | null } | null;
}

export interface SpeakingViewProps {
  /** Speaking entries to render (grouped internally by situation). */
  entries: SpeakingViewEntry[];
  /** Optional heading rendered above the grouped situations. */
  title?: string;
}

/** Default group label for entries with no owning category/situation. */
const DEFAULT_SITUATION = 'Phrases';

/** Make a stable, anchor-safe DOM id from a situation label. */
function situationId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `speaking-${slug || 'group'}`;
}

/**
 * Split dialogue text into individual conversational turns. The legacy source
 * separates turns with a leading "-- " marker and/or line breaks; we split on
 * newlines and the "--" marker, trimming the marker off for display.
 *
 * Exported for direct unit testing.
 */
export function splitDialogueLines(text: string): string[] {
  return text
    .split(/\r?\n|(?=--\s)/) // break on newlines or before each "-- " turn
    .map((line) => line.replace(/^\s*--\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function SpeakingEntryItem({ entry }: { entry: SpeakingViewEntry }) {
  const lines = splitDialogueLines(entry.word);
  const definitions = entry.definitions ?? [];

  return (
    <li className="rounded-md border border-border bg-surface-elevated p-3">
      <ol className="space-y-1" aria-label="Dialogue">
        {lines.map((line, index) => (
          <li
            key={index}
            className="flex gap-2 text-foreground"
            data-dialogue-line=""
          >
            <span aria-hidden="true" className="select-none text-speaking">
              –
            </span>
            <div className="flex-1">
              <Markdown>{line}</Markdown>
            </div>
          </li>
        ))}
      </ol>

      {definitions.length > 0 ? (
        <dl className="mt-2 border-t border-border pt-2">
          <dt className="sr-only">Translation</dt>
          {definitions.map((def, index) => (
            <dd key={def.id ?? index} className="text-sm text-muted">
              <Markdown>{def.text}</Markdown>
            </dd>
          ))}
        </dl>
      ) : null}

      {entry.notes ? (
        <div className="mt-2 text-sm text-muted">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Usage
          </p>
          <Markdown>{entry.notes}</Markdown>
        </div>
      ) : null}
    </li>
  );
}

export function SpeakingView({ entries, title }: SpeakingViewProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No speaking entries yet.</p>;
  }

  // Group entries by situation (category name), preserving first-seen order of
  // both groups and entries within a group (R14.3).
  const order: string[] = [];
  const groups = new Map<string, SpeakingViewEntry[]>();
  for (const entry of entries) {
    const situation = entry.category?.name?.trim() || DEFAULT_SITUATION;
    if (!groups.has(situation)) {
      groups.set(situation, []);
      order.push(situation);
    }
    groups.get(situation)!.push(entry);
  }

  return (
    <div className="space-y-8">
      {title ? (
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
      ) : null}

      {order.map((situation) => {
        const id = situationId(situation);
        return (
          <section key={situation} aria-labelledby={id}>
            <h2
              id={id}
              className="mb-3 border-b border-border pb-1 text-xl font-semibold text-speaking"
            >
              {situation}
            </h2>
            <ul className="space-y-3">
              {groups.get(situation)!.map((entry) => (
                <SpeakingEntryItem key={entry.id} entry={entry} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default SpeakingView;
