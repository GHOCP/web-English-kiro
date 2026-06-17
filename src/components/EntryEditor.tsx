// EntryEditor — create/edit a lexical entry (Task 15, R2/R3/R4).
//
// A modal dialog form for creating and editing entries. It supports the full
// entry shape: word (required), pronunciation, entry type, Markdown notes, a
// dynamic list of definitions (Markdown text + optional part of speech), a
// dynamic list of examples (Markdown text), and inline image upload with
// thumbnail previews.
//
// Markdown live preview (R3, Task 5): every Markdown field (notes, each
// definition, each example) renders its current text through the shared
// `Markdown` component beneath the textarea, so the owner sees exactly how the
// sanitized content will look while typing.
//
// Validation (NFR 3.1): the same pure validators the API uses
// (`validateCreateEntry` / `validateUpdateEntry`) run client-side first to give
// instant inline field errors without a round-trip. The server is still
// authoritative — if it returns 400 with `fieldErrors`, those are merged into
// the inline messages, and a 409 surfaces a clear "already exists in this
// category" message.
//
// Image flow (R4): `POST /api/images` requires an existing `entryId`. To keep
// the UX coherent across both modes:
//   - Edit mode: the entry already exists, so images upload immediately against
//     `entry.id`; the returned thumbnail is shown via
//     `GET /api/images/:id/file?variant=thumb`, and each image can be removed
//     via `DELETE /api/images/:id`.
//   - Create mode: there is no entry id yet, so the image section is disabled
//     with a hint until the entry is saved once. On the first successful save
//     the editor transitions into edit mode for the new entry (keeping the
//     dialog open) so images can then be attached. The dialog therefore does
//     NOT auto-close on save; closing is explicit (Close button / Escape /
//     backdrop), which lets the owner attach images right after creating.
//
// Cache (R11.4): after any successful save or image change, all `/api/entries`
// SWR caches are revalidated via `useSWRConfig().mutate` so lists/detail views
// refresh.
//
// Accessibility (NFR 2.x): the container is a labelled `role="dialog"` with
// `aria-modal`, focus moves into the dialog on open and is restored on close,
// Tab is trapped within the dialog, and Escape closes it. Every input is
// associated with a visible <label>.
//
// Requirements: 2.1, 2.2, 2.4, 3.2, 3.4, 4.3.
'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';

import { Markdown } from '@/components/Markdown';
import {
  validateCreateEntry,
  validateUpdateEntry,
} from '@/lib/validation';
import type {
  ApiErrorResponse,
  CreateEntryRequest,
  EntryType,
  EntryWithRelations,
  FieldError,
  ImageUploadResponse,
  UpdateEntryRequest,
} from '@/types';

// ---------------------------------------------------------------------------
// Props & internal form state
// ---------------------------------------------------------------------------

/**
 * A selectable target category in the editor's category dropdown. `depth`
 * drives the indentation so the subtree hierarchy stays readable.
 */
export interface CategoryOption {
  id: number;
  name: string;
  depth: number;
}

export interface EntryEditorProps {
  /**
   * The entry being edited. Omit (or pass `null`) for create mode. When
   * provided the form is pre-populated and submits via PATCH.
   */
  entry?: EntryWithRelations | null;
  /**
   * Target category for a newly created entry. Required in create mode; in
   * edit mode the entry's own category is used unless overridden here.
   */
  categoryId?: number;
  /**
   * The categories the entry may be assigned to — typically the open
   * category and all of its descendant sub-categories, flattened and ordered
   * for display. When provided (and holding more than one option) the editor
   * shows a category picker so the owner can choose the exact sub-category
   * (e.g. the "A", "B", "C" … buckets under "A~Z"). When omitted the entry is
   * assigned to `categoryId` as before.
   */
  categoryOptions?: CategoryOption[];
  /** Called after every successful save with the persisted entry. */
  onSaved?: (entry: EntryWithRelations) => void;
  /** Called when the dialog should close (Close button / Escape / backdrop). */
  onClose: () => void;
}

/** A single definition row in the form. */
interface DefinitionField {
  text: string;
  partOfSpeech: string;
}

/** A single example row in the form. */
interface ExampleField {
  text: string;
}

/** Minimal image shape the editor needs to render a thumbnail + remove it. */
interface AttachedImage {
  id: number;
  altText: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the initial definition rows from an entry (or a single blank row). */
function initialDefinitions(entry?: EntryWithRelations | null): DefinitionField[] {
  if (entry && entry.definitions.length > 0) {
    return entry.definitions.map((d) => ({
      text: d.text,
      partOfSpeech: d.partOfSpeech ?? '',
    }));
  }
  return [{ text: '', partOfSpeech: '' }];
}

/** Build the initial example rows from an entry (empty list by default). */
function initialExamples(entry?: EntryWithRelations | null): ExampleField[] {
  if (entry && entry.examples.length > 0) {
    return entry.examples.map((e) => ({ text: e.text }));
  }
  return [];
}

/** CSS selector matching the focusable elements inside the dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function EntryEditor({
  entry,
  categoryId,
  categoryOptions,
  onSaved,
  onClose,
}: EntryEditorProps) {
  const isEditMode = Boolean(entry);
  const effectiveCategoryId = entry?.categoryId ?? categoryId;

  // The category the entry will be saved to. Defaults to the entry's current
  // category (edit) or the page category (create), and can be changed via the
  // category picker when `categoryOptions` are supplied.
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | undefined>(
    effectiveCategoryId,
  );

  // Only show the picker when there is a real choice to make.
  const showCategoryPicker =
    Array.isArray(categoryOptions) && categoryOptions.length > 1;

  // Scalar fields.
  const [word, setWord] = useState(entry?.word ?? '');
  const [pronunciation, setPronunciation] = useState(entry?.pronunciation ?? '');
  // Entry type is not user-editable: new entries default to "word" and editing
  // preserves whatever type the entry already had.
  const entryType: EntryType = (entry?.entryType as EntryType) ?? 'word';
  const [notes, setNotes] = useState(entry?.notes ?? '');

  // Dynamic lists.
  const [definitions, setDefinitions] = useState<DefinitionField[]>(() =>
    initialDefinitions(entry),
  );
  const [examples, setExamples] = useState<ExampleField[]>(() =>
    initialExamples(entry),
  );

  // Images + the saved entry id that authorizes uploads.
  const [images, setImages] = useState<AttachedImage[]>(
    () => entry?.images.map((i) => ({ id: i.id, altText: i.altText })) ?? [],
  );
  const [savedEntryId, setSavedEntryId] = useState<number | null>(
    entry?.id ?? null,
  );

  // Feedback state.
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { mutate } = useSWRConfig();

  const dialogRef = useRef<HTMLDivElement>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Look up the inline message for a given field path, if any. */
  const errorFor = useCallback(
    (field: string): string | undefined =>
      fieldErrors.find((e) => e.field === field)?.message,
    [fieldErrors],
  );

  // -------------------------------------------------------------------------
  // Focus management: focus into the dialog on open, restore focus on close,
  // trap Tab within the dialog, and close on Escape.
  // -------------------------------------------------------------------------
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    // Focus the first meaningful field once mounted.
    wordInputRef.current?.focus();
    return () => {
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  // -------------------------------------------------------------------------
  // Definition handlers
  // -------------------------------------------------------------------------
  const addDefinition = useCallback(() => {
    setDefinitions((prev) => [...prev, { text: '', partOfSpeech: '' }]);
  }, []);

  const removeDefinition = useCallback((index: number) => {
    setDefinitions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateDefinition = useCallback(
    (index: number, patch: Partial<DefinitionField>) => {
      setDefinitions((prev) =>
        prev.map((d, i) => (i === index ? { ...d, ...patch } : d)),
      );
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Example handlers
  // -------------------------------------------------------------------------
  const addExample = useCallback(() => {
    setExamples((prev) => [...prev, { text: '' }]);
  }, []);

  const removeExample = useCallback((index: number) => {
    setExamples((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateExample = useCallback((index: number, text: string) => {
    setExamples((prev) => prev.map((e, i) => (i === index ? { text } : e)));
  }, []);

  // -------------------------------------------------------------------------
  // Build + validate the payload, then submit (POST create / PATCH edit).
  // -------------------------------------------------------------------------

  /** Assemble the request body from the current form state. */
  const buildPayload = useCallback((): CreateEntryRequest | UpdateEntryRequest => {
    const defs = definitions.map((d) => {
      const partOfSpeech = d.partOfSpeech.trim();
      return partOfSpeech.length > 0
        ? { text: d.text, partOfSpeech }
        : { text: d.text };
    });
    const exs = examples.map((e) => ({ text: e.text }));

    if (isEditMode) {
      const payload: UpdateEntryRequest = {
        word,
        pronunciation: pronunciation.trim().length > 0 ? pronunciation : null,
        entryType,
        notes: notes.trim().length > 0 ? notes : null,
        definitions: defs,
        examples: exs,
      };
      // Allow re-assigning the entry to a different (sub-)category.
      if (selectedCategoryId !== undefined) {
        payload.categoryId = selectedCategoryId;
      }
      return payload;
    }

    const payload: CreateEntryRequest = {
      word,
      categoryId: selectedCategoryId ?? effectiveCategoryId ?? 0,
      definitions: defs,
    };
    if (pronunciation.trim().length > 0) payload.pronunciation = pronunciation;
    if (entryType !== 'word') payload.entryType = entryType;
    if (notes.trim().length > 0) payload.notes = notes;
    if (exs.length > 0) payload.examples = exs;
    return payload;
  }, [
    definitions,
    examples,
    isEditMode,
    word,
    pronunciation,
    entryType,
    notes,
    selectedCategoryId,
    effectiveCategoryId,
  ]);

  const revalidateEntries = useCallback(
    () =>
      mutate(
        (key) => typeof key === 'string' && key.startsWith('/api/entries'),
        undefined,
        { revalidate: true },
      ),
    [mutate],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(null);
      setStatusMessage(null);

      const payload = buildPayload();

      // Client-side validation mirrors the server's pure validators so the
      // owner gets instant inline feedback (the server still validates).
      const clientResult = isEditMode
        ? validateUpdateEntry(payload)
        : validateCreateEntry(payload);
      if (!clientResult.success) {
        setFieldErrors(clientResult.errors);
        return;
      }
      setFieldErrors([]);

      setSaving(true);
      try {
        const url =
          isEditMode && savedEntryId !== null
            ? `/api/entries/${savedEntryId}`
            : '/api/entries';
        const method = isEditMode ? 'PATCH' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const saved = (await res.json()) as EntryWithRelations;
          setSavedEntryId(saved.id);
          setImages(saved.images.map((i) => ({ id: i.id, altText: i.altText })));
          setFieldErrors([]);
          setStatusMessage(
            isEditMode
              ? 'Changes saved.'
              : 'Entry created. You can now attach images.',
          );
          await revalidateEntries();
          onSaved?.(saved);
          return;
        }

        if (res.status === 409) {
          setFormError(
            'An entry with this word already exists in this category.',
          );
          return;
        }

        if (res.status === 400) {
          const body = (await res.json()) as ApiErrorResponse;
          if (body.fieldErrors && body.fieldErrors.length > 0) {
            setFieldErrors(body.fieldErrors);
          }
          setFormError(body.error ?? 'Please correct the highlighted fields.');
          return;
        }

        setFormError('Something went wrong while saving. Please try again.');
      } catch {
        setFormError('Network error while saving. Please try again.');
      } finally {
        setSaving(false);
      }
    },
    [
      buildPayload,
      isEditMode,
      savedEntryId,
      revalidateEntries,
      onSaved,
    ],
  );

  // -------------------------------------------------------------------------
  // Image upload / removal (only available once the entry is saved).
  // -------------------------------------------------------------------------
  const handleUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so selecting the same file again re-triggers change.
      event.target.value = '';
      if (!file || savedEntryId === null) return;

      setUploadError(null);
      setUploading(true);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('entryId', String(savedEntryId));

        const res = await fetch('/api/images', { method: 'POST', body: form });
        if (res.status === 201) {
          const img = (await res.json()) as ImageUploadResponse;
          setImages((prev) => [...prev, { id: img.id, altText: img.altText }]);
          await revalidateEntries();
          return;
        }
        const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
        setUploadError(
          body?.fieldErrors?.[0]?.message ??
            body?.error ??
            'Could not upload the image.',
        );
      } catch {
        setUploadError('Network error while uploading the image.');
      } finally {
        setUploading(false);
      }
    },
    [savedEntryId, revalidateEntries],
  );

  const removeImage = useCallback(
    async (id: number) => {
      setUploadError(null);
      try {
        const res = await fetch(`/api/images/${id}`, { method: 'DELETE' });
        if (res.status === 204 || res.ok) {
          setImages((prev) => prev.filter((i) => i.id !== id));
          await revalidateEntries();
          return;
        }
        setUploadError('Could not remove the image.');
      } catch {
        setUploadError('Network error while removing the image.');
      }
    },
    [revalidateEntries],
  );

  const canUploadImages = savedEntryId !== null;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6"
      onMouseDown={(e) => {
        // Close when the backdrop (not the dialog) is clicked.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="my-4 w-full max-w-2xl rounded-lg border border-border bg-surface text-foreground shadow-xl"
      >
        <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {isEditMode ? 'Edit entry' : 'New entry'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close editor"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          {/* Body (scrollable) */}
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
            {formError ? (
              <p
                role="alert"
                className="rounded-md border border-vocabulary/40 bg-vocabulary/10 px-3 py-2 text-sm text-vocabulary"
              >
                {formError}
              </p>
            ) : null}
            {statusMessage ? (
              <p
                role="status"
                className="rounded-md border border-speaking/40 bg-speaking/10 px-3 py-2 text-sm text-speaking"
              >
                {statusMessage}
              </p>
            ) : null}

            {/* Category picker — choose the exact (sub-)category the entry
                belongs to (e.g. the "A", "B", "C" buckets under "A~Z"). */}
            {showCategoryPicker ? (
              <div>
                <label
                  htmlFor="entry-category"
                  className="block text-sm font-medium"
                >
                  Category <span className="text-vocabulary">*</span>
                </label>
                <select
                  id="entry-category"
                  value={selectedCategoryId ?? ''}
                  onChange={(e) =>
                    setSelectedCategoryId(
                      e.target.value === '' ? undefined : Number(e.target.value),
                    )
                  }
                  aria-invalid={errorFor('categoryId') ? true : undefined}
                  aria-describedby={
                    errorFor('categoryId') ? 'entry-category-error' : undefined
                  }
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                >
                  {categoryOptions!.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {`${'\u00A0\u00A0'.repeat(opt.depth)}${
                        opt.depth > 0 ? '└ ' : ''
                      }${opt.name}`}
                    </option>
                  ))}
                </select>
                {errorFor('categoryId') ? (
                  <p
                    id="entry-category-error"
                    role="alert"
                    className="mt-1 text-xs text-vocabulary"
                  >
                    {errorFor('categoryId')}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Word + pronunciation */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="entry-word" className="block text-sm font-medium">
                  Word <span className="text-vocabulary">*</span>
                </label>
                <input
                  id="entry-word"
                  ref={wordInputRef}
                  type="text"
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  aria-invalid={errorFor('word') ? true : undefined}
                  aria-describedby={errorFor('word') ? 'entry-word-error' : undefined}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                />
                {errorFor('word') ? (
                  <p id="entry-word-error" role="alert" className="mt-1 text-xs text-vocabulary">
                    {errorFor('word')}
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor="entry-pronunciation"
                  className="block text-sm font-medium"
                >
                  Pronunciation
                </label>
                <input
                  id="entry-pronunciation"
                  type="text"
                  value={pronunciation}
                  onChange={(e) => setPronunciation(e.target.value)}
                  aria-describedby={
                    errorFor('pronunciation') ? 'entry-pronunciation-error' : undefined
                  }
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                />
                {errorFor('pronunciation') ? (
                  <p
                    id="entry-pronunciation-error"
                    role="alert"
                    className="mt-1 text-xs text-vocabulary"
                  >
                    {errorFor('pronunciation')}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Definitions */}
            <fieldset className="space-y-3">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium">
                  Definitions <span className="text-vocabulary">*</span>
                </legend>
                <button
                  type="button"
                  onClick={addDefinition}
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                >
                  + Add definition
                </button>
              </div>
              {errorFor('definitions') ? (
                <p role="alert" className="text-xs text-vocabulary">
                  {errorFor('definitions')}
                </p>
              ) : null}

              {definitions.map((def, index) => {
                const textError = errorFor(`definitions[${index}].text`);
                return (
                  <div
                    key={index}
                    className="space-y-2 rounded-md border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">
                        Definition {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeDefinition(index)}
                        aria-label={`Remove definition ${index + 1}`}
                        className="rounded-md border border-border px-2 py-1 text-xs text-vocabulary hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem]">
                      <div>
                        <label
                          htmlFor={`definition-text-${index}`}
                          className="sr-only"
                        >
                          Definition {index + 1} text (Markdown)
                        </label>
                        <textarea
                          id={`definition-text-${index}`}
                          value={def.text}
                          onChange={(e) =>
                            updateDefinition(index, { text: e.target.value })
                          }
                          rows={3}
                          aria-label={`Definition ${index + 1} text`}
                          aria-invalid={textError ? true : undefined}
                          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`definition-pos-${index}`}
                          className="sr-only"
                        >
                          Definition {index + 1} part of speech
                        </label>
                        <input
                          id={`definition-pos-${index}`}
                          type="text"
                          value={def.partOfSpeech}
                          onChange={(e) =>
                            updateDefinition(index, {
                              partOfSpeech: e.target.value,
                            })
                          }
                          placeholder="part of speech"
                          aria-label={`Definition ${index + 1} part of speech`}
                          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                        />
                      </div>
                    </div>
                    {textError ? (
                      <p role="alert" className="text-xs text-vocabulary">
                        {textError}
                      </p>
                    ) : null}
                    {def.text.trim().length > 0 ? (
                      <div className="rounded-md bg-surface-elevated px-3 py-2 text-sm">
                        <span className="mb-1 block text-xs text-muted">Preview</span>
                        <Markdown>{def.text}</Markdown>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>

            {/* Examples */}
            <fieldset className="space-y-3">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium">Examples</legend>
                <button
                  type="button"
                  onClick={addExample}
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                >
                  + Add example
                </button>
              </div>

              {examples.map((ex, index) => {
                const textError = errorFor(`examples[${index}].text`);
                return (
                  <div
                    key={index}
                    className="space-y-2 rounded-md border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">
                        Example {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeExample(index)}
                        aria-label={`Remove example ${index + 1}`}
                        className="rounded-md border border-border px-2 py-1 text-xs text-vocabulary hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                      >
                        Remove
                      </button>
                    </div>
                    <label htmlFor={`example-text-${index}`} className="sr-only">
                      Example {index + 1} text (Markdown)
                    </label>
                    <textarea
                      id={`example-text-${index}`}
                      value={ex.text}
                      onChange={(e) => updateExample(index, e.target.value)}
                      rows={2}
                      aria-label={`Example ${index + 1} text`}
                      aria-invalid={textError ? true : undefined}
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                    />
                    {textError ? (
                      <p role="alert" className="text-xs text-vocabulary">
                        {textError}
                      </p>
                    ) : null}
                    {ex.text.trim().length > 0 ? (
                      <div className="rounded-md bg-surface-elevated px-3 py-2 text-sm">
                        <span className="mb-1 block text-xs text-muted">Preview</span>
                        <Markdown>{ex.text}</Markdown>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>

            {/* Notes */}
            <div>
              <label htmlFor="entry-notes" className="block text-sm font-medium">
                Notes (Markdown)
              </label>
              <textarea
                id="entry-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
              />
              {notes.trim().length > 0 ? (
                <div className="mt-2 rounded-md bg-surface-elevated px-3 py-2 text-sm">
                  <span className="mb-1 block text-xs text-muted">Preview</span>
                  <Markdown>{notes}</Markdown>
                </div>
              ) : null}
            </div>

            {/* Images */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Images</legend>
              {!canUploadImages ? (
                <p className="text-xs text-muted">
                  Save the entry first to attach images.
                </p>
              ) : (
                <div className="space-y-3">
                  <label
                    htmlFor="entry-image-upload"
                    className="block text-sm font-medium"
                  >
                    Upload image (JPEG, PNG, or WebP up to 5MB)
                  </label>
                  <input
                    id="entry-image-upload"
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleUpload}
                    disabled={uploading}
                    className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-elevated file:px-3 file:py-1.5 file:text-sm"
                  />
                  {uploading ? (
                    <p role="status" className="text-xs text-muted">
                      Uploading…
                    </p>
                  ) : null}
                  {uploadError ? (
                    <p role="alert" className="text-xs text-vocabulary">
                      {uploadError}
                    </p>
                  ) : null}

                  {images.length > 0 ? (
                    <ul className="flex flex-wrap gap-3">
                      {images.map((img) => (
                        <li key={img.id} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/images/${img.id}/file?variant=thumb`}
                            alt={img.altText ?? 'Entry image thumbnail'}
                            className="h-24 w-24 rounded-md border border-border object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => removeImage(img.id)}
                            aria-label={`Remove image ${img.id}`}
                            className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-vocabulary shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                          >
                            <span aria-hidden="true">✕</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </fieldset>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-writing px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-writing disabled:opacity-60"
            >
              {saving ? 'Saving…' : isEditMode ? 'Save changes' : 'Create entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EntryEditor;
