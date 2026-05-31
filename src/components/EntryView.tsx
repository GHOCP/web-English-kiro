// Entry detail view (Task 16, R2.4 + R2.5 + R3.3 + R9.5).
//
// Presentational, read-only view of a single lexical entry and all of its
// populated fields, laid out with a clear visual hierarchy:
//
//   word + pronunciation (heading)  →  entry-type badge
//   → definitions (ordered, optional part-of-speech, Markdown)
//   → examples (Markdown)
//   → notes (Markdown)
//   → image thumbnails (each links to the original)
//
// All user-authored text (definitions, examples, notes) is rendered through the
// shared <Markdown> component so the stored Markdown is displayed safely
// (sanitized) — never as raw HTML (R3.3, NFR 4.1).
//
// When the entry belongs to a thesaurus category (its category's
// `viewType === "thesaurus"`), a link to the full group view is surfaced so the
// owner can study the related synonyms together (R2.5, R9.5).
//
// This component is purely presentational: the fully-populated
// `EntryWithRelations` is passed in (data fetching lives in Task 19), which
// keeps it trivially testable without a server.
//
// Accessibility (NFR 2.1, NFR 2.4): semantic <article>/<section> structure with
// headings, an ordered list for the numbered senses, and descriptive alt text
// on every thumbnail.
//
// Requirements: 2.4, 2.5, 9.2, 9.3, 9.5, 3.3
import Link from 'next/link';
import { Markdown } from './Markdown';
import type { EntryWithRelations, Definition, Example, Image } from '@/types';

export interface EntryViewProps {
  /** The fully-populated entry (definitions, examples, images, category). */
  entry: EntryWithRelations;
}

/** Human-readable label for an entry's `entryType`. */
function entryTypeLabel(entryType: string): string {
  switch (entryType) {
    case 'word':
      return 'Word';
    case 'phrase':
      return 'Phrase';
    case 'structure':
      return 'Structure';
    case 'expression':
      return 'Expression';
    case 'speaking':
      return 'Speaking';
    default:
      return entryType;
  }
}

/** Stable ascending sort by `displayOrder` without mutating the input. */
function byDisplayOrder<T extends { displayOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder);
}

export function EntryView({ entry }: EntryViewProps) {
  const definitions: Definition[] = byDisplayOrder(entry.definitions);
  const examples: Example[] = byDisplayOrder(entry.examples);
  const images: Image[] = entry.images;
  const isThesaurus = entry.category?.viewType === 'thesaurus';

  return (
    <article
      aria-labelledby={`entry-word-${entry.id}`}
      className="mx-auto max-w-2xl text-foreground"
    >
      <header className="border-b border-border pb-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1
            id={`entry-word-${entry.id}`}
            className="text-3xl font-bold tracking-tight"
            lang="en"
          >
            {entry.word}
          </h1>
          {entry.pronunciation ? (
            <p className="text-lg text-muted" aria-label="Pronunciation">
              {entry.pronunciation}
            </p>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-border bg-surface-elevated px-2.5 py-0.5 text-xs font-medium text-muted">
            {entryTypeLabel(entry.entryType)}
          </span>
          {entry.category ? (
            <span className="text-xs text-muted">
              in{' '}
              <Link
                href={`/category/${entry.categoryId}`}
                className="text-writing underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
              >
                {entry.category.name}
              </Link>
            </span>
          ) : null}
        </div>

        {isThesaurus ? (
          <p className="mt-3">
            <Link
              href={`/category/${entry.categoryId}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-writing underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
            >
              <span aria-hidden="true">↗</span>
              View full thesaurus group
            </Link>
          </p>
        ) : null}
      </header>

      {definitions.length > 0 ? (
        <section aria-labelledby={`entry-definitions-${entry.id}`} className="mt-6">
          <h2
            id={`entry-definitions-${entry.id}`}
            className="text-sm font-semibold uppercase tracking-wide text-muted"
          >
            {definitions.length > 1 ? 'Definitions' : 'Definition'}
          </h2>
          <ol className="mt-2 space-y-3">
            {definitions.map((definition, index) => (
              <li key={definition.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 select-none text-sm font-semibold text-muted"
                >
                  {index + 1}.
                </span>
                <div className="flex-1">
                  {definition.partOfSpeech ? (
                    <span className="mr-2 italic text-muted">
                      {definition.partOfSpeech}
                    </span>
                  ) : null}
                  <Markdown className="prose-sm inline-block max-w-none align-baseline">
                    {definition.text}
                  </Markdown>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {examples.length > 0 ? (
        <section aria-labelledby={`entry-examples-${entry.id}`} className="mt-6">
          <h2
            id={`entry-examples-${entry.id}`}
            className="text-sm font-semibold uppercase tracking-wide text-muted"
          >
            {examples.length > 1 ? 'Examples' : 'Example'}
          </h2>
          <ul className="mt-2 space-y-2 border-l-2 border-border pl-4">
            {examples.map((example) => (
              <li key={example.id} className="text-foreground/90">
                <Markdown className="max-w-none">{example.text}</Markdown>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {entry.notes ? (
        <section aria-labelledby={`entry-notes-${entry.id}`} className="mt-6">
          <h2
            id={`entry-notes-${entry.id}`}
            className="text-sm font-semibold uppercase tracking-wide text-muted"
          >
            Notes
          </h2>
          <div className="mt-2">
            <Markdown className="max-w-none">{entry.notes}</Markdown>
          </div>
        </section>
      ) : null}

      {images.length > 0 ? (
        <section aria-labelledby={`entry-images-${entry.id}`} className="mt-6">
          <h2
            id={`entry-images-${entry.id}`}
            className="text-sm font-semibold uppercase tracking-wide text-muted"
          >
            {images.length > 1 ? 'Images' : 'Image'}
          </h2>
          <ul className="mt-2 flex flex-wrap gap-3">
            {images.map((image) => {
              const alt = image.altText ?? entry.word;
              return (
                <li key={image.id}>
                  {/* Thumbnail links to the original full-size image. */}
                  <a
                    href={`/api/images/${image.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-md border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/images/${image.id}/file?variant=thumb`}
                      alt={alt}
                      className="h-24 w-24 object-cover"
                      loading="lazy"
                    />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

export default EntryView;
