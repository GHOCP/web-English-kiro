// Input validation & sanitization for the Lexical Resources System.
//
// Pure, DB-free helpers used by the API route handlers (Wave 3) to validate
// and normalize request payloads *before* they touch Prisma. Validation
// covers entry create/update, category create/update, and image-upload
// metadata. Errors are reported at the field level using the shared
// `FieldError` / `ApiErrorResponse` shapes so the editor can surface inline
// messages.
//
// Design references:
// - "Error Handling" and "Security Considerations (NFR4)" in design.md.
// - Request contracts are imported from `@/types` (never redefined here).
//
// Notes on scope:
// - These functions are PURE: no database access, no filesystem, no I/O. The
//   actual `(word, categoryId)` uniqueness is enforced by the Prisma
//   `@@unique` constraint; this module exposes `checkDuplicateEntry` /
//   `duplicateEntryError` helpers the API calls *after* its own DB lookup.
// - Sanitization here means trimming/normalizing string input (NFR 4.1).
//   XSS-safe *rendering* of stored Markdown is handled separately by the
//   Markdown sanitizer (Task 5); this layer only validates/normalizes input.
//
// Requirements: NFR 3.1 (validate before write), NFR 4.1 (sanitize input),
// 2.1 (entry required fields).
import type {
  CreateEntryRequest,
  UpdateEntryRequest,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  DefinitionInput,
  ExampleInput,
  FieldError,
  ApiErrorResponse,
} from '@/types';
import type {
  CategoryViewType,
  CategoryPartOfSpeech,
  EntryType,
} from '@/types';

// ---------------------------------------------------------------------------
// Allowed value sets (kept in sync with the Prisma schema string unions).
// ---------------------------------------------------------------------------

/** Entry types accepted by the API (Entry.entryType). */
export const ENTRY_TYPES = [
  'word',
  'phrase',
  'structure',
  'expression',
  'speaking',
] as const satisfies readonly EntryType[];

/** Category render hints (Category.viewType). */
export const CATEGORY_VIEW_TYPES = [
  'list',
  'thesaurus',
  'genre',
  'writing',
  'speaking',
] as const satisfies readonly CategoryViewType[];

/** Part-of-speech groupings for thesaurus categories (Category.partOfSpeech). */
export const CATEGORY_PARTS_OF_SPEECH = [
  'V',
  'N',
  'ADJ',
  'Collection',
] as const satisfies readonly CategoryPartOfSpeech[];

/** Accepted image MIME types for uploads (R4.1 / NFR 4.2). */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/** Maximum accepted image size: 5 MB (R4.1 / NFR 4.2). */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Result + metadata types
// ---------------------------------------------------------------------------

/**
 * Discriminated result of a validation call. On success the payload is the
 * *normalized* (trimmed/sanitized) value; on failure it carries field-level
 * errors ready to drop into an `ApiErrorResponse`.
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: FieldError[] };

/** Image-upload metadata (everything needed to validate without the bytes). */
export interface ImageUploadMetadata {
  mimeType: string;
  size: number;
  altText?: string | null;
}

/** Normalized image metadata returned on successful validation. */
export interface ValidatedImageUpload {
  mimeType: AllowedImageMimeType;
  size: number;
  altText: string | null;
}

// ---------------------------------------------------------------------------
// Type guards / primitive predicates
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

/** Type guard: is `value` one of the allowed entry types? */
export function isEntryType(value: unknown): value is EntryType {
  return isString(value) && (ENTRY_TYPES as readonly string[]).includes(value);
}

/** Type guard: is `value` one of the allowed category view types? */
export function isCategoryViewType(value: unknown): value is CategoryViewType {
  return (
    isString(value) &&
    (CATEGORY_VIEW_TYPES as readonly string[]).includes(value)
  );
}

/** Type guard: is `value` an allowed thesaurus part-of-speech? */
export function isCategoryPartOfSpeech(
  value: unknown,
): value is CategoryPartOfSpeech {
  return (
    isString(value) &&
    (CATEGORY_PARTS_OF_SPEECH as readonly string[]).includes(value)
  );
}

/** Type guard: is `value` an accepted upload MIME type? */
export function isAllowedImageMimeType(
  value: unknown,
): value is AllowedImageMimeType {
  return (
    isString(value) &&
    (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Sanitization helpers (NFR 4.1)
// ---------------------------------------------------------------------------

/** Normalize CRLF/CR line endings to LF so stored Markdown is consistent. */
function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

/**
 * Trim outer whitespace while preserving internal formatting (line breaks,
 * indentation). Use for free-form Markdown text (definitions/examples/notes).
 */
export function sanitizeMarkdownText(value: string): string {
  return normalizeNewlines(value).trim();
}

/**
 * Trim and collapse internal whitespace runs to a single space. Use for short
 * single-line identifiers (word, category name, pronunciation) so that
 * "  go   home " and "go home" compare equal for duplicate detection.
 */
export function sanitizeSingleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/** Wrap field errors in the standard `ApiErrorResponse` envelope. */
export function toErrorResponse(
  errors: FieldError[],
  message = 'Validation failed',
): ApiErrorResponse {
  return { error: message, fieldErrors: errors };
}

/** Human-readable message for the duplicate-entry conflict (R2 / NFR 3.3). */
export const DUPLICATE_ENTRY_MESSAGE =
  'An entry with this word already exists in this category.';

/**
 * Build the `ApiErrorResponse` for a duplicate (word, categoryId) conflict.
 * The API returns this with HTTP 409. Kept here so the message/shape stays
 * consistent across every route that writes entries.
 */
export function duplicateEntryError(): ApiErrorResponse {
  return {
    error: 'Duplicate entry',
    fieldErrors: [{ field: 'word', message: DUPLICATE_ENTRY_MESSAGE }],
  };
}

/**
 * Duplicate-prevention helper for the API layer (NFR 3.3). This module is
 * DB-free, so the caller performs the lookup (e.g.
 * `prisma.entry.findUnique({ where: { word_categoryId: ... } })`) and passes
 * the result here.
 *
 * @param existingEntry  The row found for the target (word, categoryId), or
 *                        `null` when none exists.
 * @param ignoreEntryId  When updating an entry, pass its id so matching itself
 *                        is not flagged as a duplicate.
 * @returns An `ApiErrorResponse` when a real conflict exists, otherwise `null`.
 */
export function checkDuplicateEntry(
  existingEntry: { id: number } | null | undefined,
  ignoreEntryId?: number,
): ApiErrorResponse | null {
  if (!existingEntry) return null;
  if (ignoreEntryId !== undefined && existingEntry.id === ignoreEntryId) {
    return null;
  }
  return duplicateEntryError();
}

// ---------------------------------------------------------------------------
// Shared field validators (push onto an accumulating error list)
// ---------------------------------------------------------------------------

function validateCategoryIdField(
  value: unknown,
  field: string,
  errors: FieldError[],
): number | undefined {
  if (!isInteger(value) || value <= 0) {
    errors.push({ field, message: `${field} must be a positive integer.` });
    return undefined;
  }
  return value;
}

function validateDisplayOrderField(
  value: unknown,
  field: string,
  errors: FieldError[],
): number | undefined {
  if (!isInteger(value) || value < 0) {
    errors.push({
      field,
      message: `${field} must be a non-negative integer.`,
    });
    return undefined;
  }
  return value;
}

/**
 * Validate + sanitize a list of definitions/examples whose items each carry a
 * required non-empty `text`. Returns the normalized items; pushes field-level
 * errors (e.g. `definitions[1].text`) for any invalid entry.
 */
function validateTextItems(
  value: unknown,
  field: 'definitions' | 'examples',
  errors: FieldError[],
  { requireNonEmptyArray }: { requireNonEmptyArray: boolean },
): { text: string; partOfSpeech?: string }[] | undefined {
  if (!Array.isArray(value)) {
    errors.push({ field, message: `${field} must be an array.` });
    return undefined;
  }
  if (requireNonEmptyArray && value.length === 0) {
    errors.push({
      field,
      message: `At least one ${field === 'definitions' ? 'definition' : 'example'} is required.`,
    });
    return undefined;
  }

  const out: { text: string; partOfSpeech?: string }[] = [];
  value.forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push({
        field: `${field}[${index}]`,
        message: `${field}[${index}] must be an object.`,
      });
      return;
    }
    const text = item.text;
    if (!isString(text) || sanitizeMarkdownText(text).length === 0) {
      errors.push({
        field: `${field}[${index}].text`,
        message: 'Text is required and cannot be empty.',
      });
      return;
    }

    const normalized: { text: string; partOfSpeech?: string } = {
      text: sanitizeMarkdownText(text),
    };

    if (field === 'definitions' && 'partOfSpeech' in item) {
      const pos = item.partOfSpeech;
      if (pos !== undefined && pos !== null) {
        if (!isString(pos)) {
          errors.push({
            field: `${field}[${index}].partOfSpeech`,
            message: 'partOfSpeech must be a string.',
          });
        } else {
          const trimmed = sanitizeSingleLine(pos);
          if (trimmed.length > 0) normalized.partOfSpeech = trimmed;
        }
      }
    }
    out.push(normalized);
  });

  return out;
}

function validateImageIdsField(
  value: unknown,
  errors: FieldError[],
): number[] | undefined {
  if (!Array.isArray(value)) {
    errors.push({ field: 'imageIds', message: 'imageIds must be an array.' });
    return undefined;
  }
  const out: number[] = [];
  value.forEach((id, index) => {
    if (!isInteger(id) || id <= 0) {
      errors.push({
        field: `imageIds[${index}]`,
        message: 'Each image id must be a positive integer.',
      });
      return;
    }
    out.push(id);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Entry validation (R2, R3, NFR 3.1)
// ---------------------------------------------------------------------------

/**
 * Validate a `POST /api/entries` payload.
 *
 * Rules: `word` required & non-empty; `categoryId` required positive integer;
 * `definitions` a non-empty array whose items each have non-empty `text`;
 * `entryType` (if present) in the allowed union; optional pronunciation/notes/
 * examples/imageIds validated when present. String inputs are trimmed and
 * normalized.
 */
export function validateCreateEntry(
  input: unknown,
): ValidationResult<CreateEntryRequest> {
  const errors: FieldError[] = [];
  if (!isPlainObject(input)) {
    return {
      success: false,
      errors: [{ field: 'body', message: 'Request body must be an object.' }],
    };
  }

  // word (required, non-empty)
  let word = '';
  if (!isString(input.word) || sanitizeSingleLine(input.word).length === 0) {
    errors.push({ field: 'word', message: 'Word is required and cannot be empty.' });
  } else {
    word = sanitizeSingleLine(input.word);
  }

  // categoryId (required, positive integer)
  const categoryId =
    validateCategoryIdField(input.categoryId, 'categoryId', errors) ?? 0;

  // pronunciation (optional)
  let pronunciation: string | undefined;
  if (input.pronunciation !== undefined && input.pronunciation !== null) {
    if (!isString(input.pronunciation)) {
      errors.push({
        field: 'pronunciation',
        message: 'pronunciation must be a string.',
      });
    } else {
      const cleaned = sanitizeSingleLine(input.pronunciation);
      if (cleaned.length > 0) pronunciation = cleaned;
    }
  }

  // entryType (optional, union)
  let entryType: EntryType | undefined;
  if (input.entryType !== undefined && input.entryType !== null) {
    if (!isEntryType(input.entryType)) {
      errors.push({
        field: 'entryType',
        message: `entryType must be one of: ${ENTRY_TYPES.join(', ')}.`,
      });
    } else {
      entryType = input.entryType;
    }
  }

  // notes (optional)
  let notes: string | undefined;
  if (input.notes !== undefined && input.notes !== null) {
    if (!isString(input.notes)) {
      errors.push({ field: 'notes', message: 'notes must be a string.' });
    } else {
      const cleaned = sanitizeMarkdownText(input.notes);
      if (cleaned.length > 0) notes = cleaned;
    }
  }

  // definitions (required, non-empty)
  const definitions = validateTextItems(input.definitions, 'definitions', errors, {
    requireNonEmptyArray: true,
  });

  // examples (optional)
  let examples: ExampleInput[] | undefined;
  if (input.examples !== undefined && input.examples !== null) {
    const validated = validateTextItems(input.examples, 'examples', errors, {
      requireNonEmptyArray: false,
    });
    if (validated) examples = validated.map((e) => ({ text: e.text }));
  }

  // imageIds (optional)
  let imageIds: number[] | undefined;
  if (input.imageIds !== undefined && input.imageIds !== null) {
    imageIds = validateImageIdsField(input.imageIds, errors);
  }

  if (errors.length > 0) return { success: false, errors };

  const data: CreateEntryRequest = {
    word,
    categoryId,
    definitions: (definitions ?? []) as DefinitionInput[],
  };
  if (pronunciation !== undefined) data.pronunciation = pronunciation;
  if (entryType !== undefined) data.entryType = entryType;
  if (notes !== undefined) data.notes = notes;
  if (examples !== undefined) data.examples = examples;
  if (imageIds !== undefined) data.imageIds = imageIds;

  return { success: true, data };
}

/**
 * Validate a `PATCH /api/entries/:id` payload. All fields are optional, but
 * any supplied field must be valid. Supplying `definitions` replaces the set,
 * so when present it must be a non-empty array of non-empty texts (an entry
 * must keep at least one definition). `examples` may be an empty array to clear
 * them. `pronunciation`/`notes` accept `null` to explicitly clear the field.
 */
export function validateUpdateEntry(
  input: unknown,
): ValidationResult<UpdateEntryRequest> {
  const errors: FieldError[] = [];
  if (!isPlainObject(input)) {
    return {
      success: false,
      errors: [{ field: 'body', message: 'Request body must be an object.' }],
    };
  }

  const data: UpdateEntryRequest = {};

  if ('word' in input && input.word !== undefined) {
    if (!isString(input.word) || sanitizeSingleLine(input.word).length === 0) {
      errors.push({ field: 'word', message: 'Word cannot be empty.' });
    } else {
      data.word = sanitizeSingleLine(input.word);
    }
  }

  if ('pronunciation' in input && input.pronunciation !== undefined) {
    if (input.pronunciation === null) {
      data.pronunciation = null;
    } else if (!isString(input.pronunciation)) {
      errors.push({
        field: 'pronunciation',
        message: 'pronunciation must be a string or null.',
      });
    } else {
      const cleaned = sanitizeSingleLine(input.pronunciation);
      data.pronunciation = cleaned.length > 0 ? cleaned : null;
    }
  }

  if ('categoryId' in input && input.categoryId !== undefined) {
    const categoryId = validateCategoryIdField(
      input.categoryId,
      'categoryId',
      errors,
    );
    if (categoryId !== undefined) data.categoryId = categoryId;
  }

  if ('entryType' in input && input.entryType !== undefined) {
    if (!isEntryType(input.entryType)) {
      errors.push({
        field: 'entryType',
        message: `entryType must be one of: ${ENTRY_TYPES.join(', ')}.`,
      });
    } else {
      data.entryType = input.entryType;
    }
  }

  if ('notes' in input && input.notes !== undefined) {
    if (input.notes === null) {
      data.notes = null;
    } else if (!isString(input.notes)) {
      errors.push({ field: 'notes', message: 'notes must be a string or null.' });
    } else {
      const cleaned = sanitizeMarkdownText(input.notes);
      data.notes = cleaned.length > 0 ? cleaned : null;
    }
  }

  if ('definitions' in input && input.definitions !== undefined) {
    const validated = validateTextItems(input.definitions, 'definitions', errors, {
      requireNonEmptyArray: true,
    });
    if (validated) data.definitions = validated as DefinitionInput[];
  }

  if ('examples' in input && input.examples !== undefined) {
    const validated = validateTextItems(input.examples, 'examples', errors, {
      requireNonEmptyArray: false,
    });
    if (validated) data.examples = validated.map((e) => ({ text: e.text }));
  }

  if ('imageIds' in input && input.imageIds !== undefined) {
    const ids = validateImageIdsField(input.imageIds, errors);
    if (ids) data.imageIds = ids;
  }

  if ('displayOrder' in input && input.displayOrder !== undefined) {
    const order = validateDisplayOrderField(
      input.displayOrder,
      'displayOrder',
      errors,
    );
    if (order !== undefined) data.displayOrder = order;
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data };
}

// ---------------------------------------------------------------------------
// Category validation (R1, R9, NFR 3.1)
// ---------------------------------------------------------------------------

/**
 * Validate a `POST /api/categories` payload. `name` required & non-empty;
 * optional `parentId` (positive integer or null), `displayOrder`
 * (non-negative integer), `viewType` and `partOfSpeech` in their unions.
 */
export function validateCreateCategory(
  input: unknown,
): ValidationResult<CreateCategoryRequest> {
  const errors: FieldError[] = [];
  if (!isPlainObject(input)) {
    return {
      success: false,
      errors: [{ field: 'body', message: 'Request body must be an object.' }],
    };
  }

  let name = '';
  if (!isString(input.name) || sanitizeSingleLine(input.name).length === 0) {
    errors.push({ field: 'name', message: 'Name is required and cannot be empty.' });
  } else {
    name = sanitizeSingleLine(input.name);
  }

  let parentId: number | null | undefined;
  if (input.parentId !== undefined) {
    if (input.parentId === null) {
      parentId = null;
    } else {
      const validated = validateCategoryIdField(input.parentId, 'parentId', errors);
      if (validated !== undefined) parentId = validated;
    }
  }

  let displayOrder: number | undefined;
  if (input.displayOrder !== undefined && input.displayOrder !== null) {
    const validated = validateDisplayOrderField(
      input.displayOrder,
      'displayOrder',
      errors,
    );
    if (validated !== undefined) displayOrder = validated;
  }

  let viewType: CategoryViewType | undefined;
  if (input.viewType !== undefined && input.viewType !== null) {
    if (!isCategoryViewType(input.viewType)) {
      errors.push({
        field: 'viewType',
        message: `viewType must be one of: ${CATEGORY_VIEW_TYPES.join(', ')}.`,
      });
    } else {
      viewType = input.viewType;
    }
  }

  let partOfSpeech: CategoryPartOfSpeech | undefined;
  if (input.partOfSpeech !== undefined && input.partOfSpeech !== null) {
    if (!isCategoryPartOfSpeech(input.partOfSpeech)) {
      errors.push({
        field: 'partOfSpeech',
        message: `partOfSpeech must be one of: ${CATEGORY_PARTS_OF_SPEECH.join(', ')}.`,
      });
    } else {
      partOfSpeech = input.partOfSpeech;
    }
  }

  if (errors.length > 0) return { success: false, errors };

  const data: CreateCategoryRequest = { name };
  if (parentId !== undefined) data.parentId = parentId;
  if (displayOrder !== undefined) data.displayOrder = displayOrder;
  if (viewType !== undefined) data.viewType = viewType;
  if (partOfSpeech !== undefined) data.partOfSpeech = partOfSpeech;

  return { success: true, data };
}

/**
 * Validate a `PATCH /api/categories/:id` payload (rename / reorder / move).
 * All fields optional. `parentId` accepts a positive integer or `null`
 * (move to root); cycle prevention is enforced server-side against the DB.
 * `partOfSpeech` accepts `null` to clear it.
 */
export function validateUpdateCategory(
  input: unknown,
): ValidationResult<UpdateCategoryRequest> {
  const errors: FieldError[] = [];
  if (!isPlainObject(input)) {
    return {
      success: false,
      errors: [{ field: 'body', message: 'Request body must be an object.' }],
    };
  }

  const data: UpdateCategoryRequest = {};

  if ('name' in input && input.name !== undefined) {
    if (!isString(input.name) || sanitizeSingleLine(input.name).length === 0) {
      errors.push({ field: 'name', message: 'Name cannot be empty.' });
    } else {
      data.name = sanitizeSingleLine(input.name);
    }
  }

  if ('parentId' in input && input.parentId !== undefined) {
    if (input.parentId === null) {
      data.parentId = null;
    } else {
      const validated = validateCategoryIdField(input.parentId, 'parentId', errors);
      if (validated !== undefined) data.parentId = validated;
    }
  }

  if ('displayOrder' in input && input.displayOrder !== undefined) {
    const validated = validateDisplayOrderField(
      input.displayOrder,
      'displayOrder',
      errors,
    );
    if (validated !== undefined) data.displayOrder = validated;
  }

  if ('viewType' in input && input.viewType !== undefined) {
    if (!isCategoryViewType(input.viewType)) {
      errors.push({
        field: 'viewType',
        message: `viewType must be one of: ${CATEGORY_VIEW_TYPES.join(', ')}.`,
      });
    } else {
      data.viewType = input.viewType;
    }
  }

  if ('partOfSpeech' in input && input.partOfSpeech !== undefined) {
    if (input.partOfSpeech === null) {
      data.partOfSpeech = null;
    } else if (!isCategoryPartOfSpeech(input.partOfSpeech)) {
      errors.push({
        field: 'partOfSpeech',
        message: `partOfSpeech must be one of: ${CATEGORY_PARTS_OF_SPEECH.join(', ')}, or null.`,
      });
    } else {
      data.partOfSpeech = input.partOfSpeech;
    }
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data };
}

// ---------------------------------------------------------------------------
// Image-upload metadata validation (R4.1, NFR 4.2)
// ---------------------------------------------------------------------------

/**
 * Validate image-upload metadata: MIME type must be JPEG/PNG/WebP and size
 * must be a positive number not exceeding 5 MB. The actual byte-level MIME
 * sniffing happens in the image library (Task 6); this validates the declared
 * metadata so the API can reject bad uploads with field-level errors.
 */
export function validateImageUpload(
  input: unknown,
): ValidationResult<ValidatedImageUpload> {
  const errors: FieldError[] = [];
  if (!isPlainObject(input)) {
    return {
      success: false,
      errors: [{ field: 'body', message: 'Upload metadata must be an object.' }],
    };
  }

  let mimeType: AllowedImageMimeType | undefined;
  if (!isAllowedImageMimeType(input.mimeType)) {
    errors.push({
      field: 'mimeType',
      message: `Unsupported image type. Allowed: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}.`,
    });
  } else {
    mimeType = input.mimeType;
  }

  let size = 0;
  if (!isFiniteNumber(input.size)) {
    errors.push({ field: 'size', message: 'size must be a number (bytes).' });
  } else if (input.size <= 0) {
    errors.push({ field: 'size', message: 'size must be greater than zero.' });
  } else if (input.size > MAX_IMAGE_SIZE_BYTES) {
    errors.push({
      field: 'size',
      message: `Image exceeds the maximum size of ${MAX_IMAGE_SIZE_BYTES} bytes (5 MB).`,
    });
  } else {
    size = input.size;
  }

  let altText: string | null = null;
  if (input.altText !== undefined && input.altText !== null) {
    if (!isString(input.altText)) {
      errors.push({ field: 'altText', message: 'altText must be a string.' });
    } else {
      const cleaned = sanitizeSingleLine(input.altText);
      altText = cleaned.length > 0 ? cleaned : null;
    }
  }

  if (errors.length > 0 || mimeType === undefined) {
    return { success: false, errors };
  }

  return { success: true, data: { mimeType, size, altText } };
}
