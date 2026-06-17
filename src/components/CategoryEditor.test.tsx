import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * CategoryEditor component tests.
 *
 * Covers the create / edit / delete flows for managing (sub-)category
 * "sections":
 *   - create posts to /api/categories with name, viewType, and parentId,
 *   - edit patches /api/categories/:id with the changed fields,
 *   - the delete sub-flow requires explicit confirmation and posts the chosen
 *     mode (cascade or reassign + target),
 *   - empty name surfaces an inline error without a network call.
 */

import { CategoryEditor } from './CategoryEditor';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CategoryEditor', () => {
  it('renders an accessible labelled dialog in create mode', () => {
    render(
      <CategoryEditor
        mode="create"
        defaultParentId={1}
        parentOptions={[{ id: 1, name: 'A~Z', depth: 0 }]}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: /new section/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('posts a new section to /api/categories on create', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 99 }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const onSaved = vi.fn();

    render(
      <CategoryEditor
        mode="create"
        defaultParentId={1}
        parentOptions={[
          { id: 1, name: 'A~Z', depth: 0 },
          { id: 2, name: '#A', depth: 1 },
        ]}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText(/section name/i), 'B');
    await user.click(screen.getByRole('button', { name: /create section/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/categories');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('B');
    expect(body.parentId).toBe(1);
  });

  it('patches the category on edit (rename)', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 5 }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const onSaved = vi.fn();

    render(
      <CategoryEditor
        mode="edit"
        category={{ id: 5, name: 'Old name', viewType: 'list' }}
        onSaved={onSaved}
        onClose={() => {}}
      />,
    );

    const nameInput = screen.getByLabelText(/section name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'New name');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/categories/5');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string).name).toBe('New name');
  });

  it('requires confirmation then cascade-deletes the section', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ mode: 'cascade', deletedCategoryIds: [5] }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const onDeleted = vi.fn();

    render(
      <CategoryEditor
        mode="edit"
        category={{ id: 5, name: 'Doomed', viewType: 'list' }}
        onDeleted={onDeleted}
        onClose={() => {}}
      />,
    );

    // The destructive action requires opening the confirmation first.
    await user.click(screen.getByRole('button', { name: /delete section/i }));
    await user.click(screen.getByRole('button', { name: /confirm delete/i }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/categories/5');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string).mode).toBe('cascade');
  });

  it('deletes with reassign when a target is chosen', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ mode: 'reassign' }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const onDeleted = vi.fn();

    render(
      <CategoryEditor
        mode="edit"
        category={{ id: 5, name: 'Doomed', viewType: 'list' }}
        reassignOptions={[{ id: 8, name: 'Keeper', depth: 0 }]}
        onDeleted={onDeleted}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /delete section/i }));
    await user.click(screen.getByLabelText(/move the entries elsewhere/i));
    await user.click(screen.getByRole('button', { name: /confirm delete/i }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.mode).toBe('reassign');
    expect(body.reassignToCategoryId).toBe(8);
  });

  it('shows an inline error when the name is empty and does not call the API', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <CategoryEditor
        mode="create"
        defaultParentId={1}
        parentOptions={[{ id: 1, name: 'A~Z', depth: 0 }]}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: /create section/i }));

    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
