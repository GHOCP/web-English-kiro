import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateCreateEntry,
  validateUpdateEntry,
  validateCreateCategory,
  validateUpdateCategory,
  validateImageUpload,
  checkDuplicateEntry,
  duplicateEntryError,
  toErrorResponse,
  sanitizeSingleLine,
  sanitizeMarkdownText,
  isEntryType,
  isCategoryViewType,
  isCategoryPartOfSpeech,
  isAllowedImageMimeType,
  ENTRY_TYPES,
  CATEGORY_VIEW_TYPES,
  CATEGORY_PARTS_OF_SPEECH,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  DUPLICATE_ENTRY_MESSAGE,
  type ValidationResult,
} from './validation';

/**
 * Unit + property-based tests for the input validation/sanitization utilities
 * (Task 4). Covers valid/invalid payloads and edge cases for entry, category,
 * and image-upload validation, plus duplicate-prevention helpers.
 *
 * Requirements: NFR 3.1 (validate before write), NFR 4.1 (sanitize input),
 * 2.1 (entry required fields).
 */

/** Narrow a result to its error list for assertions. */
function errorsOf<T>(result: ValidationResult<T>): { field: string; message: string }[] {
  if (result.success) throw new Error('expected validation to fail');
  return result.errors;
}

function dataOf<T>(result: ValidationResult<T>): T {
  if (!result.success) {
    throw new Error(`expected validation to succeed: ${JSON.stringify(result.errors)}`);
  }
  return result.data;
}

function hasFieldError<T>(result: ValidationResult<T>, field: string): boolean {
  return !result.success && result.errors.some((e) => e.field === field);
}

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

describe('sanitizeSingleLine', () => {
  it('trims and collapses internal whitespace runs', () => {
    expect(sanitizeSingleLine('  go    home ')).toBe('go home');
    expect(sanitizeSingleLine('go\thome')).toBe('go home');
    expect(sanitizeSingleLine('\n provoke \n')).toBe('provoke');
  });
});

describe('sanitizeMarkdownText', () => {
  it('trims outer whitespace but preserves internal line breaks', () => {
    expect(sanitizeMarkdownText('  line1\nline2  ')).toBe('line1\nline2');
  });

  it('normalizes CRLF/CR to LF', () => {
    expect(sanitizeMarkdownText('a\r\nb\rc')).toBe('a\nb\nc');
  });
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('type guards', () => {
  it('isEntryType accepts only allowed values', () => {
    for (const t of ENTRY_TYPES) expect(isEntryType(t)).toBe(true);
    expect(isEntryType('nope')).toBe(false);
    expect(isEntryType(undefined)).toBe(false);
    expect(isEntryType(5)).toBe(false);
  });

  it('isCategoryViewType accepts only allowed values', () => {
    for (const v of CATEGORY_VIEW_TYPES) expect(isCategoryViewType(v)).toBe(true);
    expect(isCategoryViewType('grid')).toBe(false);
  });

  it('isCategoryPartOfSpeech accepts only allowed values', () => {
    for (const p of CATEGORY_PARTS_OF_SPEECH)
      expect(isCategoryPartOfSpeech(p)).toBe(true);
    expect(isCategoryPartOfSpeech('Verb')).toBe(false);
  });

  it('isAllowedImageMimeType accepts only allowed values', () => {
    for (const m of ALLOWED_IMAGE_MIME_TYPES)
      expect(isAllowedImageMimeType(m)).toBe(true);
    expect(isAllowedImageMimeType('image/gif')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Entry create validation
// ---------------------------------------------------------------------------

describe('validateCreateEntry', () => {
  const valid = {
    word: 'provoke',
    categoryId: 1,
    definitions: [{ text: '激起，激发 to stimulate' }],
  };

  it('accepts a minimal valid payload', () => {
    const data = dataOf(validateCreateEntry(valid));
    expect(data.word).toBe('provoke');
    expect(data.categoryId).toBe(1);
    expect(data.definitions).toEqual([{ text: '激起，激发 to stimulate' }]);
  });

  it('trims and normalizes the word', () => {
    const data = dataOf(validateCreateEntry({ ...valid, word: '  go    home ' }));
    expect(data.word).toBe('go home');
  });

  it('accepts a full valid payload with all optional fields', () => {
    const data = dataOf(
      validateCreateEntry({
        word: 'provoke',
        pronunciation: '  /prəˈvoʊk/  ',
        categoryId: 2,
        entryType: 'word',
        notes: '  some note  ',
        definitions: [
          { text: ' def one ', partOfSpeech: ' v ' },
          { text: 'def two' },
        ],
        examples: [{ text: ' ex one ' }],
        imageIds: [1, 2, 3],
      }),
    );
    expect(data.pronunciation).toBe('/prəˈvoʊk/');
    expect(data.entryType).toBe('word');
    expect(data.notes).toBe('some note');
    expect(data.definitions[0]).toEqual({ text: 'def one', partOfSpeech: 'v' });
    expect(data.definitions[1]).toEqual({ text: 'def two' });
    expect(data.examples).toEqual([{ text: 'ex one' }]);
    expect(data.imageIds).toEqual([1, 2, 3]);
  });

  it('rejects a non-object body', () => {
    expect(hasFieldError(validateCreateEntry(null), 'body')).toBe(true);
    expect(hasFieldError(validateCreateEntry('x'), 'body')).toBe(true);
    expect(hasFieldError(validateCreateEntry([]), 'body')).toBe(true);
  });

  it('requires a non-empty word', () => {
    expect(hasFieldError(validateCreateEntry({ ...valid, word: '' }), 'word')).toBe(true);
    expect(hasFieldError(validateCreateEntry({ ...valid, word: '   ' }), 'word')).toBe(true);
    expect(hasFieldError(validateCreateEntry({ ...valid, word: 123 }), 'word')).toBe(true);
    const { word, ...noWord } = valid;
    expect(hasFieldError(validateCreateEntry(noWord), 'word')).toBe(true);
  });

  it('requires a positive integer categoryId', () => {
    expect(hasFieldError(validateCreateEntry({ ...valid, categoryId: 0 }), 'categoryId')).toBe(true);
    expect(hasFieldError(validateCreateEntry({ ...valid, categoryId: -1 }), 'categoryId')).toBe(true);
    expect(hasFieldError(validateCreateEntry({ ...valid, categoryId: 1.5 }), 'categoryId')).toBe(true);
    expect(hasFieldError(validateCreateEntry({ ...valid, categoryId: '1' }), 'categoryId')).toBe(true);
  });

  it('requires at least one definition', () => {
    expect(hasFieldError(validateCreateEntry({ ...valid, definitions: [] }), 'definitions')).toBe(true);
    expect(hasFieldError(validateCreateEntry({ ...valid, definitions: 'x' }), 'definitions')).toBe(true);
  });

  it('reports per-index errors for empty definition text', () => {
    const result = validateCreateEntry({
      ...valid,
      definitions: [{ text: 'ok' }, { text: '   ' }],
    });
    expect(hasFieldError(result, 'definitions[1].text')).toBe(true);
  });

  it('rejects an invalid entryType', () => {
    expect(hasFieldError(validateCreateEntry({ ...valid, entryType: 'noun' }), 'entryType')).toBe(true);
  });

  it('rejects non-positive image ids', () => {
    expect(hasFieldError(validateCreateEntry({ ...valid, imageIds: [1, 0] }), 'imageIds[1]')).toBe(true);
    expect(hasFieldError(validateCreateEntry({ ...valid, imageIds: 'x' }), 'imageIds')).toBe(true);
  });

  it('omits optional fields that normalize to empty', () => {
    const data = dataOf(
      validateCreateEntry({ ...valid, pronunciation: '   ', notes: '   ' }),
    );
    expect(data.pronunciation).toBeUndefined();
    expect(data.notes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Entry update validation
// ---------------------------------------------------------------------------

describe('validateUpdateEntry', () => {
  it('accepts an empty patch', () => {
    expect(dataOf(validateUpdateEntry({}))).toEqual({});
  });

  it('accepts a partial word update', () => {
    expect(dataOf(validateUpdateEntry({ word: ' renamed ' }))).toEqual({ word: 'renamed' });
  });

  it('rejects an empty word when provided', () => {
    expect(hasFieldError(validateUpdateEntry({ word: '  ' }), 'word')).toBe(true);
  });

  it('allows clearing nullable fields with null', () => {
    const data = dataOf(validateUpdateEntry({ pronunciation: null, notes: null }));
    expect(data.pronunciation).toBeNull();
    expect(data.notes).toBeNull();
  });

  it('coerces whitespace-only nullable strings to null', () => {
    const data = dataOf(validateUpdateEntry({ pronunciation: '   ' }));
    expect(data.pronunciation).toBeNull();
  });

  it('requires non-empty definitions when the field is supplied', () => {
    expect(hasFieldError(validateUpdateEntry({ definitions: [] }), 'definitions')).toBe(true);
    expect(hasFieldError(validateUpdateEntry({ definitions: [{ text: '' }] }), 'definitions[0].text')).toBe(true);
  });

  it('allows clearing examples with an empty array', () => {
    const data = dataOf(validateUpdateEntry({ examples: [] }));
    expect(data.examples).toEqual([]);
  });

  it('validates displayOrder as a non-negative integer', () => {
    expect(dataOf(validateUpdateEntry({ displayOrder: 0 })).displayOrder).toBe(0);
    expect(hasFieldError(validateUpdateEntry({ displayOrder: -1 }), 'displayOrder')).toBe(true);
    expect(hasFieldError(validateUpdateEntry({ displayOrder: 2.5 }), 'displayOrder')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Category create validation
// ---------------------------------------------------------------------------

describe('validateCreateCategory', () => {
  it('accepts a minimal valid payload', () => {
    expect(dataOf(validateCreateCategory({ name: 'Vocabulary' }))).toEqual({
      name: 'Vocabulary',
    });
  });

  it('trims and normalizes the name', () => {
    expect(dataOf(validateCreateCategory({ name: '  Words   by genre ' })).name).toBe(
      'Words by genre',
    );
  });

  it('requires a non-empty name', () => {
    expect(hasFieldError(validateCreateCategory({ name: '' }), 'name')).toBe(true);
    expect(hasFieldError(validateCreateCategory({}), 'name')).toBe(true);
  });

  it('accepts parentId as a positive integer or null', () => {
    expect(dataOf(validateCreateCategory({ name: 'x', parentId: 3 })).parentId).toBe(3);
    expect(dataOf(validateCreateCategory({ name: 'x', parentId: null })).parentId).toBeNull();
  });

  it('rejects an invalid parentId', () => {
    expect(hasFieldError(validateCreateCategory({ name: 'x', parentId: 0 }), 'parentId')).toBe(true);
    expect(hasFieldError(validateCreateCategory({ name: 'x', parentId: 'a' }), 'parentId')).toBe(true);
  });

  it('validates viewType and partOfSpeech unions', () => {
    expect(dataOf(validateCreateCategory({ name: 'x', viewType: 'thesaurus', partOfSpeech: 'V' }))).toEqual({
      name: 'x',
      viewType: 'thesaurus',
      partOfSpeech: 'V',
    });
    expect(hasFieldError(validateCreateCategory({ name: 'x', viewType: 'grid' }), 'viewType')).toBe(true);
    expect(hasFieldError(validateCreateCategory({ name: 'x', partOfSpeech: 'Verb' }), 'partOfSpeech')).toBe(true);
  });

  it('validates displayOrder', () => {
    expect(dataOf(validateCreateCategory({ name: 'x', displayOrder: 5 })).displayOrder).toBe(5);
    expect(hasFieldError(validateCreateCategory({ name: 'x', displayOrder: -1 }), 'displayOrder')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Category update validation
// ---------------------------------------------------------------------------

describe('validateUpdateCategory', () => {
  it('accepts an empty patch', () => {
    expect(dataOf(validateUpdateCategory({}))).toEqual({});
  });

  it('accepts moving to root via parentId null', () => {
    expect(dataOf(validateUpdateCategory({ parentId: null })).parentId).toBeNull();
  });

  it('allows clearing partOfSpeech with null', () => {
    expect(dataOf(validateUpdateCategory({ partOfSpeech: null })).partOfSpeech).toBeNull();
  });

  it('rejects an empty name when supplied', () => {
    expect(hasFieldError(validateUpdateCategory({ name: '   ' }), 'name')).toBe(true);
  });

  it('rejects invalid unions', () => {
    expect(hasFieldError(validateUpdateCategory({ viewType: 'x' }), 'viewType')).toBe(true);
    expect(hasFieldError(validateUpdateCategory({ partOfSpeech: 'x' }), 'partOfSpeech')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Image-upload metadata validation
// ---------------------------------------------------------------------------

describe('validateImageUpload', () => {
  it('accepts a valid JPEG under the size limit', () => {
    const data = dataOf(validateImageUpload({ mimeType: 'image/jpeg', size: 1024 }));
    expect(data).toEqual({ mimeType: 'image/jpeg', size: 1024, altText: null });
  });

  it('accepts an image exactly at the 5MB boundary', () => {
    const data = dataOf(
      validateImageUpload({ mimeType: 'image/png', size: MAX_IMAGE_SIZE_BYTES }),
    );
    expect(data.size).toBe(MAX_IMAGE_SIZE_BYTES);
  });

  it('rejects an image over the size limit', () => {
    expect(
      hasFieldError(
        validateImageUpload({ mimeType: 'image/webp', size: MAX_IMAGE_SIZE_BYTES + 1 }),
        'size',
      ),
    ).toBe(true);
  });

  it('rejects zero or negative sizes', () => {
    expect(hasFieldError(validateImageUpload({ mimeType: 'image/jpeg', size: 0 }), 'size')).toBe(true);
    expect(hasFieldError(validateImageUpload({ mimeType: 'image/jpeg', size: -5 }), 'size')).toBe(true);
  });

  it('rejects a disallowed MIME type', () => {
    expect(hasFieldError(validateImageUpload({ mimeType: 'image/gif', size: 100 }), 'mimeType')).toBe(true);
  });

  it('trims altText and coerces empty to null', () => {
    expect(dataOf(validateImageUpload({ mimeType: 'image/jpeg', size: 100, altText: '  cat  ' })).altText).toBe('cat');
    expect(dataOf(validateImageUpload({ mimeType: 'image/jpeg', size: 100, altText: '   ' })).altText).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Duplicate-prevention helpers
// ---------------------------------------------------------------------------

describe('duplicate-prevention helpers', () => {
  it('checkDuplicateEntry returns null when no existing entry', () => {
    expect(checkDuplicateEntry(null)).toBeNull();
    expect(checkDuplicateEntry(undefined)).toBeNull();
  });

  it('flags a conflict when a different entry exists', () => {
    const result = checkDuplicateEntry({ id: 10 });
    expect(result).not.toBeNull();
    expect(result?.fieldErrors?.[0].field).toBe('word');
    expect(result?.fieldErrors?.[0].message).toBe(DUPLICATE_ENTRY_MESSAGE);
  });

  it('does not flag the entry being updated as its own duplicate', () => {
    expect(checkDuplicateEntry({ id: 10 }, 10)).toBeNull();
    expect(checkDuplicateEntry({ id: 10 }, 11)).not.toBeNull();
  });

  it('duplicateEntryError carries the standard envelope', () => {
    const err = duplicateEntryError();
    expect(err.error).toBe('Duplicate entry');
    expect(err.fieldErrors).toHaveLength(1);
  });

  it('toErrorResponse wraps field errors with a message', () => {
    const env = toErrorResponse([{ field: 'word', message: 'bad' }], 'Nope');
    expect(env).toEqual({
      error: 'Nope',
      fieldErrors: [{ field: 'word', message: 'bad' }],
    });
  });
});

// ---------------------------------------------------------------------------
// Property-based / edge-case coverage (fast-check)
// ---------------------------------------------------------------------------

describe('property-based edge cases', () => {
  it('a sanitized single-line string has no leading/trailing whitespace and no double spaces', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = sanitizeSingleLine(s);
        expect(out).toBe(out.trim());
        expect(out.includes('  ')).toBe(false);
      }),
    );
  });

  it('valid create-entry payloads always succeed and echo a trimmed word', () => {
    const wordArb = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((w) => sanitizeSingleLine(w).length > 0);
    fc.assert(
      fc.property(
        wordArb,
        fc.integer({ min: 1, max: 100_000 }),
        fc.array(fc.string({ minLength: 1 }).filter((t) => t.trim().length > 0), {
          minLength: 1,
          maxLength: 5,
        }),
        (word, categoryId, defTexts) => {
          const result = validateCreateEntry({
            word,
            categoryId,
            definitions: defTexts.map((text) => ({ text })),
          });
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.word).toBe(sanitizeSingleLine(word));
            expect(result.data.word.length).toBeGreaterThan(0);
            expect(result.data.definitions).toHaveLength(defTexts.length);
          }
        },
      ),
    );
  });

  it('any non-positive or non-integer categoryId is always rejected', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ max: 0 }),
          fc.double({ min: 0.1, max: 100, noInteger: true }),
          fc.constant('5'),
          fc.constant(null),
        ),
        (badId) => {
          const result = validateCreateEntry({
            word: 'ok',
            categoryId: badId as unknown,
            definitions: [{ text: 'ok' }],
          });
          expect(hasFieldError(result, 'categoryId')).toBe(true);
        },
      ),
    );
  });

  it('image sizes are accepted iff within (0, 5MB] for an allowed MIME type', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED_IMAGE_MIME_TYPES),
        fc.integer({ min: -100, max: MAX_IMAGE_SIZE_BYTES + 100 }),
        (mimeType, size) => {
          const result = validateImageUpload({ mimeType, size });
          const shouldPass = size > 0 && size <= MAX_IMAGE_SIZE_BYTES;
          expect(result.success).toBe(shouldPass);
        },
      ),
    );
  });

  it('only allowed entryType strings are accepted', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = validateCreateEntry({
          word: 'ok',
          categoryId: 1,
          definitions: [{ text: 'ok' }],
          entryType: s as unknown,
        });
        const allowed = (ENTRY_TYPES as readonly string[]).includes(s);
        expect(result.success).toBe(allowed);
      }),
    );
  });
});
