// Client-side entry detail wrapper (Task 19, R2/R11.1/R11.4).
//
// Interactivity layer for an `/entry/:id` page. The page Server Component loads
// the fully-populated entry from the database for a fast first paint (R11.1)
// and passes it here as `initialEntry`. This component:
//
//   - hydrates SWR (keyed by `/api/entries/:id`) with that entry via
//     `fallbackData`, so the cache is warm and revisits are instant (R11.4);
//   - renders the presentational `EntryView`;
//   - hosts the open/close state for the `EntryEditor` so the owner can edit
//     the entry in place; on save, SWR revalidates and the view updates without
//     a full page reload.
//   - hosts a confirm-before-delete flow (R2.3): the owner must confirm in an
//     alert dialog before the entry is permanently removed via
//     `DELETE /api/entries/:id`, after which we navigate back to the category.
//
// Requirements: 2.2, 2.3, 2.4, 11.1, 11.4
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';

import { EntryView } from '@/components/EntryView';
import { EntryEditor } from '@/components/EntryEditor';
import type { EntryWithRelations } from '@/types';

export interface EntryDetailProps {
  /** Entry id (the route param). */
  id: number;
  /** SSR-fetched entry used to hydrate SWR for an instant first paint. */
  initialEntry: EntryWithRelations;
}

/** SWR key for a single entry's data. */
export function entryDataKey(id: number): string {
  return `/api/entries/${id}`;
}

const fetcher = (url: string): Promise<EntryWithRelations> =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Failed to load entry (${res.status})`);
    return res.json() as Promise<EntryWithRelations>;
  });

export function EntryDetail({ id, initialEntry }: EntryDetailProps) {
  const router = useRouter();
  const { data, mutate } = useSWR<EntryWithRelations>(
    entryDataKey(id),
    fetcher,
    { fallbackData: initialEntry, revalidateOnFocus: false },
  );
  const { mutate: globalMutate } = useSWRConfig();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const entry = data ?? initialEntry;

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/entries/${id}`, { method: 'DELETE' });
      if (res.ok) {
        // Drop this entry's own SWR cache and invalidate the owning category's
        // page-data cache so the list no longer shows the deleted entry, then
        // refresh the App Router cache before navigating back (R11.4).
        await globalMutate(
          (key) =>
            typeof key === 'string' &&
            (key === entryDataKey(id) ||
              key === `/api/categories/${entry.categoryId}` ||
              key.startsWith('/api/entries')),
          undefined,
          { revalidate: true },
        );
        router.push(`/category/${entry.categoryId}`);
        router.refresh();
        return;
      }
      setDeleteError('Could not delete this entry. Please try again.');
    } catch {
      setDeleteError('Network error while deleting. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
        >
          Edit entry
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="rounded-md border border-vocabulary/50 px-3 py-1.5 text-sm font-medium text-vocabulary hover:bg-vocabulary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-writing"
        >
          Delete entry
        </button>
      </div>

      <EntryView entry={entry} />

      {editing ? (
        <EntryEditor
          entry={entry}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            // Update the SWR cache with the saved entry and revalidate.
            void mutate(saved, { revalidate: true });
          }}
        />
      ) : null}

      {confirmingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !deleting) {
              setConfirmingDelete(false);
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-entry-title"
            aria-describedby="delete-entry-desc"
            className="w-full max-w-md rounded-lg border border-border bg-surface p-5 text-foreground shadow-xl"
          >
            <h2 id="delete-entry-title" className="text-lg font-semibold">
              Delete entry
            </h2>
            <p id="delete-entry-desc" className="mt-2 text-sm text-muted">
              Permanently delete “{entry.word}”? This cannot be undone.
            </p>
            {deleteError ? (
              <p role="alert" className="mt-3 text-sm text-vocabulary">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-surface-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-writing disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-md bg-vocabulary px-4 py-2 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-writing disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default EntryDetail;
