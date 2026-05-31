// Image storage + Sharp thumbnail helpers.
//
// Responsibilities (Task 6):
//   - MIME sniffing from magic bytes (JPEG/PNG/WebP) — never trust the
//     declared content-type or file extension (NFR 4.2).
//   - Size validation (≤ 5MB).
//   - Unique filename generation ({uuid}.{ext} + {uuid}.thumb.{ext}).
//   - Write the original plus a Sharp-generated thumbnail (~320px) to the
//     uploads directory.
//   - Delete both files for an image, tolerating already-missing files.
//   - Path safety: every read/write/delete resolves to a plain basename
//     *inside* the uploads directory. Path traversal (`..`, separators,
//     absolute paths) is rejected so the SQLite database file and any other
//     filesystem location are never reachable (NFR 4.3).
//
// The uploads directory is configurable via the `UPLOADS_DIR` environment
// variable (default: `uploads/`), which lets tests point at a temp directory.
//
// Requirements: 4.1, 4.2, 4.4, NFR 4.2, NFR 4.3
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum accepted upload size: 5MB (R4.1). */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** Longest edge (px) of a generated thumbnail (Q15). */
export const THUMBNAIL_MAX_DIMENSION = 320;

/** The image MIME types this system accepts (R4.1). */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

/** A file type detected from a buffer's magic bytes. */
export interface DetectedImageType {
  mime: AllowedImageMime;
  /** Filename extension (no dot) used for stored files. */
  ext: 'jpg' | 'png' | 'webp';
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Reason codes for a rejected upload. */
export type ImageValidationCode =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'MIME_MISMATCH';

/** Thrown by {@link storeImage} when a buffer fails validation. */
export class ImageValidationError extends Error {
  readonly code: ImageValidationCode;
  constructor(code: ImageValidationCode, message: string) {
    super(message);
    this.name = 'ImageValidationError';
    this.code = code;
  }
}

/** Thrown when a filename would resolve outside the uploads directory. */
export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

// ---------------------------------------------------------------------------
// MIME sniffing (NFR 4.2)
// ---------------------------------------------------------------------------

/**
 * Detect the true image type from a buffer's magic bytes. Returns `null` for
 * anything that is not a JPEG, PNG, or WebP. The declared content-type and
 * file extension are deliberately ignored — only the bytes are trusted.
 *
 *   JPEG : FF D8 FF
 *   PNG  : 89 50 4E 47 0D 0A 1A 0A
 *   WebP : "RIFF" .... "WEBP"  (bytes 0-3 + bytes 8-11)
 */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (!Buffer.isBuffer(buffer)) return null;

  // JPEG: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)
  ) {
    return { mime: 'image/png', ext: 'png' };
  }

  // WebP: "RIFF" at 0..3 and "WEBP" at 8..11
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validation (R4.1, NFR 4.2)
// ---------------------------------------------------------------------------

export type ValidateImageResult =
  | { ok: true; type: DetectedImageType }
  | { ok: false; code: ImageValidationCode; message: string };

/**
 * Validate an upload buffer: non-empty, within the size limit, and a genuine
 * JPEG/PNG/WebP (verified by magic bytes, not by the declared type).
 *
 * If `declaredMime` is supplied (e.g. the multipart content-type), it is
 * cross-checked against the sniffed type; a mismatch is rejected as a spoofed
 * upload (`MIME_MISMATCH`). The sniffed type is always authoritative.
 */
export function validateImage(
  buffer: Buffer,
  declaredMime?: string,
): ValidateImageResult {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, code: 'EMPTY', message: 'No image data provided.' };
  }

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    return {
      ok: false,
      code: 'TOO_LARGE',
      message: `Image exceeds the ${MAX_IMAGE_SIZE_BYTES} byte (5MB) limit.`,
    };
  }

  const type = detectImageType(buffer);
  if (!type) {
    return {
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      message: 'Unsupported image type. Only JPEG, PNG, and WebP are allowed.',
    };
  }

  if (declaredMime && declaredMime.toLowerCase() !== type.mime) {
    return {
      ok: false,
      code: 'MIME_MISMATCH',
      message: `Declared type "${declaredMime}" does not match the actual file content ("${type.mime}").`,
    };
  }

  return { ok: true, type };
}

// ---------------------------------------------------------------------------
// Path safety (NFR 4.3)
// ---------------------------------------------------------------------------

/** Absolute path of the configured uploads directory (default `uploads/`). */
export function getUploadsDir(): string {
  return path.resolve(process.env.UPLOADS_DIR ?? 'uploads');
}

/**
 * Resolve a *stored filename* to an absolute path that is guaranteed to live
 * directly inside the uploads directory. Rejects anything that could escape:
 * path separators, `..` segments, null bytes, or absolute paths. This is the
 * single choke point for every filesystem access in this module, so the DB
 * file under `data/` (and the rest of the filesystem) is never reachable.
 */
export function resolveUploadPath(
  filename: string,
  uploadsDir: string = getUploadsDir(),
): string {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new UnsafePathError('Filename must be a non-empty string.');
  }
  if (filename.includes('\0')) {
    throw new UnsafePathError('Filename must not contain null bytes.');
  }
  if (filename.includes('/') || filename.includes('\\')) {
    throw new UnsafePathError('Filename must not contain path separators.');
  }
  if (filename.includes('..')) {
    throw new UnsafePathError('Filename must not contain parent references.');
  }
  if (path.isAbsolute(filename)) {
    throw new UnsafePathError('Filename must not be an absolute path.');
  }
  // Defense in depth: a plain basename should equal itself after basename().
  if (path.basename(filename) !== filename) {
    throw new UnsafePathError('Filename must be a plain basename.');
  }

  const baseDir = path.resolve(uploadsDir);
  const resolved = path.resolve(baseDir, filename);
  const relative = path.relative(baseDir, resolved);
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new UnsafePathError(
      'Resolved path escapes the uploads directory.',
    );
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Filename generation (R4.2)
// ---------------------------------------------------------------------------

export interface GeneratedFilenames {
  filename: string; // {uuid}.{ext}
  thumbnailFilename: string; // {uuid}.thumb.{ext}
}

/** Generate a unique original + thumbnail filename pair for the given type. */
export function generateFilenames(ext: DetectedImageType['ext']): GeneratedFilenames {
  const id = randomUUID();
  return {
    filename: `${id}.${ext}`,
    thumbnailFilename: `${id}.thumb.${ext}`,
  };
}

// ---------------------------------------------------------------------------
// Store (R4.1, R4.2, Q15)
// ---------------------------------------------------------------------------

/** Metadata for a successfully stored image (original + thumbnail). */
export interface StoredImage {
  filename: string;
  thumbnailFilename: string;
  fileSize: number; // bytes of the stored original
  mime: AllowedImageMime;
  width: number; // original width (px)
  height: number; // original height (px)
}

export interface StoreImageOptions {
  /** Override the uploads directory (tests use a temp dir). */
  uploadsDir?: string;
  /** Declared content-type to cross-check against the sniffed type. */
  declaredMime?: string;
}

/**
 * Validate, then persist an image buffer plus a generated thumbnail to the
 * uploads directory. Throws {@link ImageValidationError} for invalid input.
 * Both files are written inside the uploads directory (path-safe by
 * construction via {@link generateFilenames} + {@link resolveUploadPath}).
 */
export async function storeImage(
  buffer: Buffer,
  options: StoreImageOptions = {},
): Promise<StoredImage> {
  const { uploadsDir = getUploadsDir(), declaredMime } = options;

  const validation = validateImage(buffer, declaredMime);
  if (!validation.ok) {
    throw new ImageValidationError(validation.code, validation.message);
  }

  const { type } = validation;
  const { filename, thumbnailFilename } = generateFilenames(type.ext);

  const originalPath = resolveUploadPath(filename, uploadsDir);
  const thumbnailPath = resolveUploadPath(thumbnailFilename, uploadsDir);

  // Ensure the uploads directory exists before writing.
  await mkdir(path.resolve(uploadsDir), { recursive: true });

  // Read original dimensions up front so we can report them.
  const metadata = await sharp(buffer).metadata();

  await writeFile(originalPath, buffer);

  // Thumbnail: longest edge bounded to THUMBNAIL_MAX_DIMENSION, never
  // enlarged. The output format is inferred from the thumbnail extension,
  // which matches the original type.
  await sharp(buffer)
    .resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toFile(thumbnailPath);

  return {
    filename,
    thumbnailFilename,
    fileSize: buffer.length,
    mime: type.mime,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Delete (R4.4)
// ---------------------------------------------------------------------------

/** Unlink a path, treating "file already gone" as success. */
async function safeUnlink(absolutePath: string): Promise<void> {
  try {
    await unlink(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}

/**
 * Delete both the original and the thumbnail for an image. Missing files are
 * tolerated (e.g. a half-completed earlier delete). Path traversal is still
 * rejected via {@link resolveUploadPath}.
 */
export async function deleteImageFiles(
  filename: string,
  thumbnailFilename: string,
  uploadsDir: string = getUploadsDir(),
): Promise<void> {
  const originalPath = resolveUploadPath(filename, uploadsDir);
  const thumbnailPath = resolveUploadPath(thumbnailFilename, uploadsDir);

  await Promise.all([safeUnlink(originalPath), safeUnlink(thumbnailPath)]);
}
