import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  pushRecent,
  recordRecentCategory,
  getRecentCategories,
  clearRecentCategories,
  RECENT_CATEGORY_LIMIT,
} from '@/lib/recentCategories';

/**
 * Recently-viewed categories cache tests (Task 19, R11.4).
 *
 * `pushRecent` is the pure LRU core; the stateful wrapper persists to
 * localStorage (provided by jsdom in this environment). We verify most-recent-
 * first ordering, de-duplication, truncation, and round-trip persistence.
 *
 * Requirements: 11.4
 */

beforeEach(() => {
  clearRecentCategories();
});

describe('pushRecent', () => {
  it('adds a new id to the front', () => {
    expect(pushRecent([2, 3], 1)).toEqual([1, 2, 3]);
  });

  it('moves an existing id to the front without duplicating it', () => {
    expect(pushRecent([1, 2, 3], 3)).toEqual([3, 1, 2]);
  });

  it('truncates to the limit (most-recent-first)', () => {
    expect(pushRecent([1, 2, 3], 4, 3)).toEqual([4, 1, 2]);
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3];
    pushRecent(input, 4);
    expect(input).toEqual([1, 2, 3]);
  });

  it('property: result has no duplicates and length <= limit, id is first', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 50 }), { maxLength: 30 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 12 }),
        (recent, id, limit) => {
          const result = pushRecent(recent, id, limit);
          expect(result[0]).toBe(id);
          expect(result.length).toBeLessThanOrEqual(limit);
          expect(new Set(result).size).toBe(result.length);
        },
      ),
    );
  });
});

describe('recordRecentCategory persistence', () => {
  it('persists visits most-recent-first and survives a reload', () => {
    recordRecentCategory(5);
    recordRecentCategory(7);
    recordRecentCategory(5); // revisit moves 5 to the front

    expect(getRecentCategories()).toEqual([5, 7]);
  });

  it('caps the stored list at RECENT_CATEGORY_LIMIT', () => {
    for (let i = 1; i <= RECENT_CATEGORY_LIMIT + 5; i += 1) {
      recordRecentCategory(i);
    }
    const recent = getRecentCategories();
    expect(recent.length).toBe(RECENT_CATEGORY_LIMIT);
    // The most recently recorded id is at the front.
    expect(recent[0]).toBe(RECENT_CATEGORY_LIMIT + 5);
  });
});
