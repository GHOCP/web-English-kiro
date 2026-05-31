// Search logic for the Lexical Resources System (Task 10, Requirements 6.x, 11.2).
//
// Strategy (see design "Search Design"):
//   1. Normalize / trim the query. An empty (or whitespace-only) query
//      short-circuits to an empty result set WITHOUT touching the database.
//   2. Use the FTS5 virtual table ("EntryFts", rowid = Entry.id) as the fast,
//      ranked primary index, matching against `word` + concatenated definition
//      text. FTS5 token/prefix matching is sub-millisecond even at 10k entries.
//   3. FTS5 prefix matching only matches token *prefixes*, so it cannot by
//      itself guarantee substring completeness on the word field (e.g. "oke"
//      does not prefix-match "provoke"). To guarantee Property 5 (search
//      completeness) we always union an indexed `word LIKE %q%` substring scan.
//   4. When FTS5 is unavailable, or the query cannot be safely expressed as an
//      FTS5 MATCH expression, or the MATCH call throws on adversarial input, we
//      fall back entirely to a LIKE scan over `word` + definition text. FTS
//      MUST never throw out of this module.
//   5. Every candidate is finally re-verified with a case-insensitive substring
//      check against the entry's word and plain-text definitions, which
//      guarantees Property 4 (search soundness) regardless of how the candidate
//      was discovered (FTS tokenization, diacritic folding, etc.).
//
// The heavy lifting lives here (not in the route handler) so it is unit- and
// property-testable against an isolated SQLite database without going through
// HTTP.
import type { PrismaClient } from '@prisma/client';
import { markdownToPlainText, markdownToSnippet } from './markdown';
import type { SearchResult, SearchResponse } from '@/types';

/**
 * Default maximum number of results returned by a search. High enough that
 * realistic single-user queries are never silently truncated, while still
 * bounding the payload for pathological queries.
 */
export const DEFAULT_SEARCH_LIMIT = 100;

export interface SearchOptions {
  /** Maximum number of results to return (defaults to {@link DEFAULT_SEARCH_LIMIT}). */
  limit?: number;
}

/**
 * Escape the LIKE wildcards (`%`, `_`) and the escape character itself so a
 * user-supplied query is matched literally inside a `LIKE '%' || q || '%'`
 * pattern. Used with `ESCAPE '\'`.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Build an FTS5 MATCH expression from a free-text query.
 *
 * Each whitespace-separated token is wrapped as a quoted FTS5 string (with any
 * embedded double quote escaped by doubling) and turned into a prefix token via
 * a trailing `*`. Quoting neutralizes FTS5 operator characters (`-`, `"`, `:`,
 * `(`, `)`, `*`, `^`, `NEAR`, …) so adversarial input is treated as literal
 * text rather than query syntax. Tokens are joined with a space (implicit AND).
 *
 * Returns `null` when no usable token remains (e.g. an all-whitespace query),
 * signalling the caller to use the LIKE fallback.
 */
export function buildFtsMatchQuery(query: string): string | null {
  const tokens = query.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  return tokens
    .map((token) => {
      const escaped = token.replace(/"/g, '""');
      return `"${escaped}"*`;
    })
    .join(' ');
}

/** Coerce a raw-query id column (which may arrive as bigint) to a number. */
function toId(value: unknown): number {
  return Number(value);
}

/**
 * Run the FTS5 MATCH query and return candidate entry ids, or `null` if FTS is
 * unavailable / the query cannot be expressed / the MATCH call throws. Never
 * rejects: any error is swallowed and reported as `null` so the caller can fall
 * back to LIKE.
 */
async function ftsCandidateIds(
  prisma: PrismaClient,
  query: string,
): Promise<number[] | null> {
  const match = buildFtsMatchQuery(query);
  if (match === null) {
    return null;
  }
  try {
    const rows = await prisma.$queryRawUnsafe<{ rowid: number | bigint }[]>(
      'SELECT "rowid" FROM "EntryFts" WHERE "EntryFts" MATCH ?',
      match,
    );
    return rows.map((row) => toId(row.rowid));
  } catch {
    // FTS5 not compiled in, or a syntax error slipped through despite quoting.
    return null;
  }
}

/** Entry ids whose `word` contains the query as a (case-insensitive) substring. */
async function likeWordIds(
  prisma: PrismaClient,
  query: string,
): Promise<number[]> {
  const pattern = `%${escapeLike(query)}%`;
  const rows = await prisma.$queryRawUnsafe<{ id: number | bigint }[]>(
    `SELECT "id" FROM "Entry" WHERE "word" LIKE ? ESCAPE '\\'`,
    pattern,
  );
  return rows.map((row) => toId(row.id));
}

/** Entry ids whose definition text contains the query as a substring. */
async function likeDefinitionIds(
  prisma: PrismaClient,
  query: string,
): Promise<number[]> {
  const pattern = `%${escapeLike(query)}%`;
  const rows = await prisma.$queryRawUnsafe<{ entryId: number | bigint }[]>(
    `SELECT DISTINCT "entryId" FROM "Definition" WHERE "text" LIKE ? ESCAPE '\\'`,
    pattern,
  );
  return rows.map((row) => toId(row.entryId));
}

/**
 * Search lexical entries for `rawQuery`.
 *
 * Guarantees:
 *  - Property 4 (soundness): every returned entry contains the query
 *    (case-insensitive) in its word or definition text.
 *  - Property 5 (completeness): every entry whose word contains the query
 *    (case-insensitive) is returned, subject to {@link SearchOptions.limit}.
 *
 * Empty/whitespace queries return `{ query, results: [] }` without any DB hit.
 */
export async function searchEntries(
  prisma: PrismaClient,
  rawQuery: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const query = (rawQuery ?? '').trim();

  // Empty-query short-circuit: no database access at all (design Error Handling
  // table; Requirement 6.x).
  if (query === '') {
    return { query, results: [] };
  }

  // --- Collect candidate entry ids -----------------------------------------
  const candidateIds = new Set<number>();
  const ftsIds = await ftsCandidateIds(prisma, query);

  if (ftsIds !== null) {
    // Primary path: FTS5 for fast word + definition matching and ranking, plus
    // an indexed word-substring scan so prefix-only FTS never costs us
    // completeness (Property 5).
    for (const id of ftsIds) candidateIds.add(id);
    for (const id of await likeWordIds(prisma, query)) candidateIds.add(id);
  } else {
    // Fallback path: FTS unavailable or query unsafe — LIKE over word + defs.
    for (const id of await likeWordIds(prisma, query)) candidateIds.add(id);
    for (const id of await likeDefinitionIds(prisma, query)) candidateIds.add(id);
  }

  if (candidateIds.size === 0) {
    return { query, results: [] };
  }

  // --- Hydrate candidates and verify soundness ------------------------------
  const entries = await prisma.entry.findMany({
    where: { id: { in: [...candidateIds] } },
    include: {
      category: true,
      definitions: { orderBy: { displayOrder: 'asc' } },
    },
  });

  const needle = query.toLowerCase();

  interface Scored {
    entry: (typeof entries)[number];
    rank: number;
    definitionText: string;
  }

  const scored: Scored[] = [];
  for (const entry of entries) {
    const wordLower = entry.word.toLowerCase();
    const definitionText = entry.definitions
      .map((definition) => markdownToPlainText(definition.text))
      .filter((text) => text.length > 0)
      .join(' ');
    const matchesWord = wordLower.includes(needle);
    const matchesDefinition = definitionText.toLowerCase().includes(needle);

    // Soundness gate (Property 4): drop anything that does not actually contain
    // the query, e.g. FTS hits produced by tokenization / diacritic folding.
    if (!matchesWord && !matchesDefinition) {
      continue;
    }

    // Lower rank = higher relevance. Word hits always outrank definition-only
    // hits so that, within the result limit, word matches are never displaced
    // by definition-only matches (preserves Property 5 under truncation).
    let rank = 3;
    if (wordLower === needle) {
      rank = 0;
    } else if (wordLower.startsWith(needle)) {
      rank = 1;
    } else if (matchesWord) {
      rank = 2;
    }

    scored.push({ entry, rank, definitionText });
  }

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.entry.word.localeCompare(b.entry.word) ||
      a.entry.id - b.entry.id,
  );

  const results: SearchResult[] = scored
    .slice(0, limit)
    .map(({ entry, definitionText }) => ({
      entryId: entry.id,
      word: entry.word,
      categoryId: entry.categoryId,
      categoryName: entry.category.name,
      snippet: markdownToSnippet(definitionText),
    }));

  return { query, results };
}
