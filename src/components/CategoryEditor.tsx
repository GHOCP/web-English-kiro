// CategoryEditor — create / edit / delete a (sub-)category "section".
//
// The sidebar shows only the top two tiers; every deeper sub-category is
// surfaced in-content as a section header and in the floating Sections
// navigator. This modal lets the owner manage those sections directly:
//
//   - create: add a new sub-section under a chosen parent (POST /api/categories)
//   - edit:   rename / change the view type (PATCH /api/categories/:id)
//   - delete: remove the section and its subtree, choosing whether to
//             cascade-delete its entries or reassign them (DELETE …), per Q18.
//
// The category CRUD service + validators are authoritative server-side; this
// component mirrors the minimal client validation (non-empty name) for instant
// feedback and maps server field errors back onto the form.
//
// Accessibility: labelled role="dialog" with aria-modal, Escape closes, focus
// moves to the first field on open and is restored on close.
'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  ApiErrorResponse,
  CategoryPartOfSpeech,
  CategoryViewType,
  CreateCategoryRequest,
  FieldError,
  UpdateCategoryRequest,
} from '@/types';
import type { CategoryOption } from '@/components/EntryEditor';

/** The minimal category shape the editor needs in edit mode. */
export interface EditableCategory {
  id: number;
  name: string;
  viewType: CategoryViewType;
  partOfSpeech?: CategoryPartOfSpeech | null;
}

export interface CategoryEditorProps {
  /** "create" adds a new sub-section; "edit" renames/retypes/deletes one. */
  mode: 'create' | 'edit';
  /** The category being edited (required in edit mode). */
  category?: EditableCategory | null;
  /** Default parent for a newly created section (create mode). */
  defaultParentId?: number;
  /**
   * Selectable parents for a new section (create mode) — typically the open
   * category and its descendants, flattened and indented by depth.
   */
  parentOptions?: CategoryOption[];
  /**
   * Selectable reassignment targets for delete (edit mode). The caller should
   * exclude the category being deleted and its descendants; the server also
   * rejects an in-subtree target.
   */
  reassignOptions?: CategoryOption[];
  /** Called after a successful create or update. */
  onSaved?: () => void;
  /** Called after a successful delete. */
  onDeleted?: () => void;
  /** Close the dialog (Close button / Escape / backdrop). */
  onClose: () => void;
}

const VIEW_TYPES: CategoryViewType[] = [
  'list',
  'thesaurus',
  'genre',
  'writing',
  'speaking',
];

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Indent an option label by its depth so the hierarchy reads clearly. */
function optionLabel(opt: CategoryOption): string {
  return `${'\u00A0\u00A0'.repeat(opt.depth)}${opt.depth > 0 ? '└ ' : ''}${opt.name}`;
}

export function CategoryEditor({
  mode,
  category,
  defaultParentId,
  parentOptions,
  reassignOptions,
  onSaved,
  onDeleted,
  onClose,
}: CategoryEditorProps) {
  const isEdit = mode === 'edit';

  const [name, setName] = useState(category?.name ?? '');
  const [viewType, setViewType] = useState<CategoryViewType>(
    category?.viewType ?? 'list',
  );
  const [parentId, setParentId] = useState<number | undefined>(
    defaultParentId,
  );

  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete sub-flow state.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'cascade' | 'reassign'>('cascade');
  const [reassignTargetId, setReassignTargetId] = useState<number | undefined>(
    reassignOptions?.[0]?.id,
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const titleId = useId();

  const errorFor = useCallback(
    (field: string): string | undefined =>
      fieldErrors.find((e) => e.field === field)?.message,
    [fieldErrors],
  );

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    firstFieldRef.current?.focus();
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
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(null);

      if (name.trim().length === 0) {
        setFieldErrors([{ field: 'name', message: 'Name is required and cannot be empty.' }]);
        return;
      }
      setFieldErrors([]);
      setSaving(true);

      try {
        const url =
          isEdit && category ? `/api/categories/${category.id}` : '/api/categories';
        const method = isEdit ? 'PATCH' : 'POST';

        const payload: CreateCategoryRequest | UpdateCategoryRequest = isEdit
          ? ({ name: name.trim(), viewType } as UpdateCategoryRequest)
          : ({
              name: name.trim(),
              viewType,
              parentId: parentId ?? null,
            } as CreateCategoryRequest);

        const res = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          setSaving(false);
          onSaved?.();
          onClose();
          return;
        }

        if (res.status === 400) {
          const body = (await res.json()) as ApiErrorResponse;
          if (body.fieldErrors && body.fieldErrors.length > 0) {
            setFieldErrors(body.fieldErrors);
          }
          setFormError(body.error ?? 'Please correct the highlighted fields.');
        } else {
          setFormError('Something went wrong while saving. Please try again.');
        }
      } catch {
        setFormError('Network error while saving. Please try again.');
      } finally {
        setSaving(false);
      }
    },
    [name, viewType, parentId, isEdit, category, onSaved, onClose],
  );

  const handleDelete = useCallback(async () => {
    if (!category) return;
    setFormError(null);

    if (deleteMode === 'reassign' && reassignTargetId === undefined) {
      setFormError('Choose a category to move the entries into.');
      return;
    }

    setSaving(true);
    try {
      const body =
        deleteMode === 'reassign'
          ? { mode: 'reassign', reassignToCategoryId: reassignTargetId }
          : { mode: 'cascade' };

      const res = await fetch(`/api/categories/${category.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setSaving(false);
        onDeleted?.();
        onClose();
        return;
      }

      const errBody = (await res.json().catch(() => null)) as ApiErrorResponse | null;
      setFormError(
        errBody?.fieldErrors?.[0]?.message ??
          errBody?.error ??
          'Could not delete this section.',
      );
    } catch {
      setFormError('Network error while deleting. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [category, deleteMode, reassignTargetId, onDeleted, onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="my-4 w-full max-w-lg rounded-lg border border-border bg-surface text-foreground shadow-xl"
      >
        <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {isEdit ? 'Edit section' : 'New section'}
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

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {formError ? (
              <p
                role="alert"
                className="rounded-md border border-vocabulary/40 bg-vocabulary/10 px-3 py-2 text-sm text-vocabulary"
              >
                {formError}
              </p>
            ) : null}

            {/* Name */}
            <div>
              <label htmlFor="category-name" className="block text-sm font-medium">
                Section name <span className="text-vocabulary">*</span>
              </label>
              <input
                id="category-name"
                ref={firstFieldRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={errorFor('name') ? true : undefined}
                aria-describedby={errorFor('name') ? 'category-name-error' : undefined}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
              />
              {errorFor('name') ? (
                <p id="category-name-error" role="alert" className="mt-1 text-xs text-vocabulary">
                  {errorFor('name')}
                </p>
              ) : null}
            </div>

            {/* Parent (create only) */}
            {!isEdit && parentOptions && parentOptions.length > 0 ? (
              <div>
                <label htmlFor="category-parent" className="block text-sm font-medium">
                  Parent section
                </label>
                <select
                  id="category-parent"
                  value={parentId ?? ''}
                  onChange={(e) =>
                    setParentId(e.target.value === '' ? undefined : Number(e.target.value))
                  }
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                >
                  {parentOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {optionLabel(opt)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {/* View type */}
            <div>
              <label htmlFor="category-viewtype" className="block text-sm font-medium">
                View type
              </label>
              <select
                id="category-viewtype"
                value={viewType}
                onChange={(e) => setViewType(e.target.value as CategoryViewType)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing sm:w-56"
              >
                {VIEW_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                How this section&apos;s entries are displayed.
              </p>
            </div>

            {/* Delete sub-flow (edit only) */}
            {isEdit ? (
              <div className="rounded-md border border-vocabulary/30 bg-vocabulary/5 p-3">
                {!confirmingDelete ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted">
                      Delete this section and everything inside it.
                    </p>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      className="shrink-0 rounded-md border border-vocabulary/50 px-3 py-1.5 text-sm font-medium text-vocabulary hover:bg-vocabulary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-vocabulary"
                    >
                      Delete section
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-vocabulary">
                      Delete “{category?.name}” and its sub-sections?
                    </p>

                    <fieldset className="space-y-2">
                      <legend className="sr-only">What to do with the entries</legend>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name="delete-mode"
                          value="cascade"
                          checked={deleteMode === 'cascade'}
                          onChange={() => setDeleteMode('cascade')}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-medium">Delete the entries too</span>
                          <span className="block text-xs text-muted">
                            Permanently removes every entry in this section and its
                            sub-sections.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name="delete-mode"
                          value="reassign"
                          checked={deleteMode === 'reassign'}
                          onChange={() => setDeleteMode('reassign')}
                          disabled={!reassignOptions || reassignOptions.length === 0}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-medium">Move the entries elsewhere</span>
                          <span className="block text-xs text-muted">
                            Keep the entries by moving them into another section first.
                          </span>
                        </span>
                      </label>
                    </fieldset>

                    {deleteMode === 'reassign' &&
                    reassignOptions &&
                    reassignOptions.length > 0 ? (
                      <div>
                        <label
                          htmlFor="reassign-target"
                          className="block text-sm font-medium"
                        >
                          Move entries into
                        </label>
                        <select
                          id="reassign-target"
                          value={reassignTargetId ?? ''}
                          onChange={(e) =>
                            setReassignTargetId(
                              e.target.value === '' ? undefined : Number(e.target.value),
                            )
                          }
                          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                        >
                          {reassignOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {optionLabel(opt)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(false)}
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={saving}
                        className="rounded-md bg-vocabulary px-3 py-1.5 text-sm font-medium text-white hover:bg-vocabulary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-vocabulary disabled:opacity-60"
                      >
                        {saving ? 'Deleting…' : 'Confirm delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-writing px-4 py-1.5 text-sm font-medium text-white hover:bg-writing/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-writing disabled:opacity-60"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create section'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CategoryEditor;
