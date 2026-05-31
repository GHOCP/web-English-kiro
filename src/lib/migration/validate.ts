// Import-document validation (NFR 3.1).
//
// Structural validation of an `ImportDocument` before it touches Prisma. This
// guards both the migration path (parsed JSON) and the round-trip path
// (Export API JSON), so a single importer can trust its input. Errors are
// reported with a dotted `field` path (e.g. `categories[0].entries[2].word`)
// so a reviewer can locate the offending node in the JSON.
//
// Rules enforced (mirroring the Prisma schema + entry validation):
//   - top-level: `version` number, `categories` array.
//   - category: non-empty `name`; recursive `children`; `entries` array.
//   - entry: non-empty `word`; `definitions`/`examples`/`images` arrays;
//     each definition/example has a string `text`; sibling words are unique
//     within a category (the @@unique([word, categoryId]) constraint).
//   - image: string `filename`/`thumbnailFilename`, number `fileSize`.
//
// Requirements: NFR 3.1, 7.4
import type { FieldError } from '@/types';
import type {
  ImportCategory,
  ImportDocument,
  ImportEntry,
  ImportImage,
} from './types';

export type ImportValidationResult =
  | { success: true }
  | { success: false; errors: FieldError[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateImage(
  image: unknown,
  path: string,
  errors: FieldError[],
): void {
  if (!isObject(image)) {
    errors.push({ field: path, message: 'Image must be an object.' });
    return;
  }
  const img = image as Partial<ImportImage>;
  if (typeof img.filename !== 'string') {
    errors.push({ field: `${path}.filename`, message: 'filename must be a string.' });
  }
  if (typeof img.thumbnailFilename !== 'string') {
    errors.push({
      field: `${path}.thumbnailFilename`,
      message: 'thumbnailFilename must be a string.',
    });
  }
  if (typeof img.fileSize !== 'number' || !Number.isFinite(img.fileSize)) {
    errors.push({ field: `${path}.fileSize`, message: 'fileSize must be a number.' });
  }
  if (img.sourcePath !== undefined && typeof img.sourcePath !== 'string') {
    errors.push({
      field: `${path}.sourcePath`,
      message: 'sourcePath must be a string when present.',
    });
  }
}

function validateEntry(
  entry: unknown,
  path: string,
  errors: FieldError[],
): void {
  if (!isObject(entry)) {
    errors.push({ field: path, message: 'Entry must be an object.' });
    return;
  }
  const e = entry as Partial<ImportEntry>;

  if (!isNonEmptyString(e.word)) {
    errors.push({ field: `${path}.word`, message: 'word is required and cannot be empty.' });
  }

  if (!Array.isArray(e.definitions)) {
    errors.push({ field: `${path}.definitions`, message: 'definitions must be an array.' });
  } else {
    e.definitions.forEach((d, i) => {
      if (!isObject(d) || typeof (d as { text?: unknown }).text !== 'string') {
        errors.push({
          field: `${path}.definitions[${i}].text`,
          message: 'definition text must be a string.',
        });
      }
    });
  }

  if (!Array.isArray(e.examples)) {
    errors.push({ field: `${path}.examples`, message: 'examples must be an array.' });
  } else {
    e.examples.forEach((ex, i) => {
      if (!isObject(ex) || typeof (ex as { text?: unknown }).text !== 'string') {
        errors.push({
          field: `${path}.examples[${i}].text`,
          message: 'example text must be a string.',
        });
      }
    });
  }

  if (!Array.isArray(e.images)) {
    errors.push({ field: `${path}.images`, message: 'images must be an array.' });
  } else {
    e.images.forEach((img, i) => validateImage(img, `${path}.images[${i}]`, errors));
  }
}

function validateCategory(
  category: unknown,
  path: string,
  errors: FieldError[],
): void {
  if (!isObject(category)) {
    errors.push({ field: path, message: 'Category must be an object.' });
    return;
  }
  const c = category as Partial<ImportCategory>;

  if (!isNonEmptyString(c.name)) {
    errors.push({ field: `${path}.name`, message: 'name is required and cannot be empty.' });
  }

  if (!Array.isArray(c.entries)) {
    errors.push({ field: `${path}.entries`, message: 'entries must be an array.' });
  } else {
    // Duplicate-prevention: sibling words must be unique within a category
    // (matches @@unique([word, categoryId])).
    const seen = new Set<string>();
    c.entries.forEach((entry, i) => {
      validateEntry(entry, `${path}.entries[${i}]`, errors);
      const word = isObject(entry) ? (entry as { word?: unknown }).word : undefined;
      if (typeof word === 'string') {
        const key = word.trim();
        if (key) {
          if (seen.has(key)) {
            errors.push({
              field: `${path}.entries[${i}].word`,
              message: `Duplicate word "${key}" within the same category.`,
            });
          }
          seen.add(key);
        }
      }
    });
  }

  if (!Array.isArray(c.children)) {
    errors.push({ field: `${path}.children`, message: 'children must be an array.' });
  } else {
    c.children.forEach((child, i) =>
      validateCategory(child, `${path}.children[${i}]`, errors),
    );
  }
}

/** Validate an entire {@link ImportDocument}. */
export function validateImportDocument(
  document: unknown,
): ImportValidationResult {
  const errors: FieldError[] = [];

  if (!isObject(document)) {
    return { success: false, errors: [{ field: 'document', message: 'Document must be an object.' }] };
  }
  const doc = document as Partial<ImportDocument>;

  if (typeof doc.version !== 'number') {
    errors.push({ field: 'version', message: 'version must be a number.' });
  }
  if (!Array.isArray(doc.categories)) {
    errors.push({ field: 'categories', message: 'categories must be an array.' });
  } else {
    doc.categories.forEach((c, i) =>
      validateCategory(c, `categories[${i}]`, errors),
    );
  }

  return errors.length > 0 ? { success: false, errors } : { success: true };
}
