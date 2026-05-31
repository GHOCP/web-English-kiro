// Recently-viewed categories cache (Task 19, R11.4).
//
// A tiny, dependency-free LRU tracker for the category ids the owner has most
// recently visited. SWR already caches each category's page data for instant
// re-renders on revisit; this module complements that by remembering *which*
// categories were seen recently (most-recent-first), which the client uses to
// warm the SWR cache and could surface as a "recent" affordance.
//
// The core (`pushRecent`) is a pure function over an id list so it is trivially
// unit-testable. A thin stateful wrapper persists the list to `localStorage`
// when available (browser) and falls back to an in-memory list otherwise
// (SSR / tests), so importing the module never touches `window` at load time.
//
// Requirements: 11.4 (client-side caching for recently viewed categories).

/** How many recently-viewed category ids to retain. */
export const RECENT_CATEGORY_LIMIT = 10;

const STORAGE_KEY = 'lexical:recent-categories';

/**
 * Return a new list with `id` moved/added to the front (most recent) and the
 * result truncated to `limit`. The output never contains duplicates: `id` is
 * placed first and any other repeated value is collapsed to its first (most
 * recent) occurrence, so the function is robust even if `recent` itself
 * contained duplicates. Pure: the input array is never mutated.
 */
export function pushRecent(
  recent: readonly number[],
  id: number,
  limit: number = RECENT_CATEGORY_LIMIT,
): number[] {
  const next: number[] = [];
  const seen = new Set<number>([id]);
  next.push(id);
  for (const existing of recent) {
    if (seen.has(existing)) continue;
    seen.add(existing);
    next.push(existing);
  }
  return limit > 0 ? next.slice(0, limit) : next;
}

/** In-memory fallback used when `localStorage` is unavailable. */
let memoryRecent: number[] = [];

/** True when a usable `localStorage` is present (browser environment). */
function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

/** Read the persisted recent list (most-recent-first), or `[]` on any error. */
export function getRecentCategories(): number[] {
  if (!hasLocalStorage()) return [...memoryRecent];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is number =>
        typeof value === 'number' && Number.isInteger(value) && value > 0,
    );
  } catch {
    return [];
  }
}

/**
 * Record a category visit, returning the updated most-recent-first list. The
 * new list is persisted to `localStorage` when available, else kept in memory.
 */
export function recordRecentCategory(
  id: number,
  limit: number = RECENT_CATEGORY_LIMIT,
): number[] {
  const next = pushRecent(getRecentCategories(), id, limit);
  if (hasLocalStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota / serialization errors — the cache is best-effort.
    }
  } else {
    memoryRecent = next;
  }
  return next;
}

/** Clear the recent-categories cache (used by tests and a potential reset UI). */
export function clearRecentCategories(): void {
  memoryRecent = [];
  if (hasLocalStorage()) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // best-effort
    }
  }
}
