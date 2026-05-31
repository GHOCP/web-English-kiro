// Category service layer for the Lexical Resources System (Task 7).
//
// Pure-ish data operations backing the Category API route handlers
// (`/api/categories` and `/api/categories/:id`). Every function takes a Prisma
// client so it can run against the app singleton in production and against an
// isolated test database (see `src/test/testDb.ts`) in tests, without spinning
// up an HTTP server.
//
// Responsibilities:
//   - getCategoryTree:  flat rows → nested, displayOrder-sorted tree (GET).
//   - createCategory:   create + place within the parent's sibling order (POST).
//   - updateCategory:   rename / reorder / move with CYCLE PREVENTION (PATCH).
//   - deleteCategory:   reassign-entries OR cascade the subtree (DELETE, Q18).
//
// Invariants enforced (design "Correctness Properties"):
//   - Property 2 (tree integrity): a category can never become its own
//     ancestor; deleting removes the whole subtree so no `parentId` ever points
//     at a missing category, and every surviving entry references a real
//     category (reassigned to an existing target, or deleted).
//   - Property 8 (display-order stability): after any create/reorder/move/
//     delete, each sibling set carries a strict, gap-free 0..n-1 ordering.
//   - Property 9 (deletion safety): reassign moves all subtree entries to the
//     chosen target (none lost); cascade deletes them through Prisma so the
//     FTS5 sync triggers fire and `EntryFts` stays consistent.
//
// Multi-record writes run inside `prisma.$transaction` (NFR 3.2): partial
// failures roll back so the tree and ordering are never left inconsistent.
//
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 9.1, 9.4 / NFR 3.2.
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  Category,
  CategoryTree,
  CategoryTreeNode,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  DeleteCategoryRequest,
  ApiErrorResponse,
  FieldError,
} from '@/types';
import type { ValidationResult } from '@/lib/validation';

// A Prisma client or an interactive-transaction client. Service functions that
// only read accept either; mutating functions open their own transaction.
type PrismaLike = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Typed error carrying the HTTP status + standard error envelope so the route
// handlers can translate it directly into a JSON response.
// ---------------------------------------------------------------------------

export class CategoryError extends Error {
  readonly status: number;
  readonly body: ApiErrorResponse;

  constructor(status: number, body: ApiErrorResponse) {
    super(body.error);
    this.name = 'CategoryError';
    this.status = status;
    this.body = body;
  }
}

function fieldError(
  status: number,
  field: string,
  message: string,
  error = 'Validation failed',
): CategoryError {
  return new CategoryError(status, { error, fieldErrors: [{ field, message }] });
}

function notFoundError(message = 'Category not found.'): CategoryError {
  return new CategoryError(404, { error: message });
}

// ---------------------------------------------------------------------------
// Result returned by deleteCategory.
// ---------------------------------------------------------------------------

export interface DeleteCategoryResult {
  mode: DeleteCategoryRequest['mode'];
  /** Ids of every category removed (the target plus all of its descendants). */
  deletedCategoryIds: number[];
  /** Number of entries reassigned (reassign mode) or deleted (cascade mode). */
  affectedEntryCount: number;
  /** The reassignment target, when mode === 'reassign'. */
  reassignedToCategoryId?: number;
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

interface MinimalCategory {
  id: number;
  parentId: number | null;
}

/**
 * Collect the ids of `rootId` and all of its descendants. A `visited` guard
 * keeps the walk finite even if the data somehow contained a cycle (it never
 * should — moves are cycle-checked), so this is safe to call defensively.
 */
function collectSubtreeIds(
  categories: readonly MinimalCategory[],
  rootId: number,
): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const c of categories) {
    if (c.parentId != null) {
      const siblings = childrenByParent.get(c.parentId);
      if (siblings) siblings.push(c.id);
      else childrenByParent.set(c.parentId, [c.id]);
    }
  }

  const result: number[] = [];
  const visited = new Set<number>();
  const stack: number[] = [rootId];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    const children = childrenByParent.get(current);
    if (children) stack.push(...children);
  }
  return result;
}

/**
 * Renumber every category under `parentId` to a strict, contiguous 0..n-1
 * sequence ordered by current (displayOrder, id). Guarantees Property 8 for the
 * sibling set after any structural change.
 */
async function resequenceSiblings(
  tx: PrismaLike,
  parentId: number | null,
): Promise<void> {
  const siblings = await tx.category.findMany({
    where: { parentId },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  for (let i = 0; i < siblings.length; i += 1) {
    if (siblings[i] !== undefined) {
      await tx.category.update({
        where: { id: siblings[i].id },
        data: { displayOrder: i },
      });
    }
  }
}

/**
 * Place `targetId` at `targetIndex` within its `parentId` sibling group and
 * renumber the whole group to 0..n-1. `targetId` must already belong to
 * `parentId` (i.e. any parent move has already been written). When
 * `targetIndex` is omitted the target is appended to the end. The index is
 * clamped into range so out-of-bounds requests still yield a valid ordering.
 */
async function placeWithinSiblings(
  tx: PrismaLike,
  parentId: number | null,
  targetId: number,
  targetIndex?: number,
): Promise<void> {
  const siblings = await tx.category.findMany({
    where: { parentId },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });

  const orderedIds = siblings
    .map((s) => s.id)
    .filter((id) => id !== targetId);

  const insertAt =
    targetIndex === undefined
      ? orderedIds.length
      : Math.max(0, Math.min(targetIndex, orderedIds.length));
  orderedIds.splice(insertAt, 0, targetId);

  for (let i = 0; i < orderedIds.length; i += 1) {
    await tx.category.update({
      where: { id: orderedIds[i] },
      data: { displayOrder: i },
    });
  }
}

// ---------------------------------------------------------------------------
// GET /api/categories — full nested tree
// ---------------------------------------------------------------------------

/**
 * Read every category and assemble the nested `CategoryTree`. Rows are fetched
 * pre-sorted by (displayOrder, id) so each parent's `children` array is already
 * in display order. Categories whose `parentId` points nowhere (should not
 * happen given the delete semantics) are surfaced as roots rather than dropped.
 */
export async function getCategoryTree(
  client: PrismaLike,
): Promise<CategoryTree> {
  const all = await client.category.findMany({
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  });

  const nodeById = new Map<number, CategoryTreeNode>();
  for (const category of all) {
    nodeById.set(category.id, { ...category, children: [] });
  }

  const roots: CategoryTreeNode[] = [];
  for (const category of all) {
    const node = nodeById.get(category.id) as CategoryTreeNode;
    if (category.parentId == null) {
      roots.push(node);
      continue;
    }
    const parent = nodeById.get(category.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node); // defensive: orphaned parentId → treat as root
  }

  return roots;
}

// ---------------------------------------------------------------------------
// POST /api/categories — create (incl. thesaurus groups)
// ---------------------------------------------------------------------------

/**
 * Create a category and slot it into its parent's sibling order. Validates that
 * `parentId` (when given) refers to an existing category — otherwise a 400 is
 * raised. Thesaurus groups are ordinary categories created with
 * `viewType: 'thesaurus'` and a `partOfSpeech` (R9.1, R9.4).
 */
export async function createCategory(
  client: PrismaClient,
  data: CreateCategoryRequest,
): Promise<Category> {
  const parentId = data.parentId ?? null;

  return client.$transaction(async (tx) => {
    if (parentId !== null) {
      const parent = await tx.category.findUnique({
        where: { id: parentId },
        select: { id: true },
      });
      if (!parent) {
        throw fieldError(400, 'parentId', 'Parent category does not exist.');
      }
    }

    const created = await tx.category.create({
      data: {
        name: data.name,
        parentId,
        viewType: data.viewType ?? 'list',
        partOfSpeech: data.partOfSpeech ?? null,
      },
    });

    await placeWithinSiblings(tx, parentId, created.id, data.displayOrder);

    return tx.category.findUniqueOrThrow({ where: { id: created.id } });
  });
}

// ---------------------------------------------------------------------------
// PATCH /api/categories/:id — rename / reorder / move (cycle-checked)
// ---------------------------------------------------------------------------

/**
 * Update a category. Supports any combination of:
 *   - rename (`name`), change `viewType` / `partOfSpeech`;
 *   - reorder within the current parent (`displayOrder` = target index);
 *   - move under a new parent (`parentId`, `null` = root).
 *
 * Cycle prevention (Property 2): a move is rejected with 400 when the new
 * parent is the category itself or one of its descendants. After a move both
 * the old and new sibling groups are renumbered so each stays gap-free
 * (Property 8).
 */
export async function updateCategory(
  client: PrismaClient,
  id: number,
  data: UpdateCategoryRequest,
): Promise<Category> {
  return client.$transaction(async (tx) => {
    const existing = await tx.category.findUnique({ where: { id } });
    if (!existing) throw notFoundError();

    const isMove =
      data.parentId !== undefined && data.parentId !== existing.parentId;
    const newParentId = isMove
      ? (data.parentId as number | null)
      : existing.parentId;

    if (isMove && newParentId !== null) {
      const parent = await tx.category.findUnique({
        where: { id: newParentId },
        select: { id: true },
      });
      if (!parent) {
        throw fieldError(400, 'parentId', 'Parent category does not exist.');
      }

      const all = await tx.category.findMany({
        select: { id: true, parentId: true },
      });
      const subtree = collectSubtreeIds(all, id);
      if (subtree.includes(newParentId)) {
        throw fieldError(
          400,
          'parentId',
          'Cannot move a category under itself or one of its descendants.',
        );
      }
    }

    // Apply scalar field updates (and the parent move, if any).
    const scalarUpdate: Prisma.CategoryUpdateInput = {};
    if (data.name !== undefined) scalarUpdate.name = data.name;
    if (data.viewType !== undefined) scalarUpdate.viewType = data.viewType;
    if (data.partOfSpeech !== undefined) {
      scalarUpdate.partOfSpeech = data.partOfSpeech;
    }
    if (isMove) {
      scalarUpdate.parent =
        newParentId === null
          ? { disconnect: true }
          : { connect: { id: newParentId } };
    }
    if (Object.keys(scalarUpdate).length > 0) {
      await tx.category.update({ where: { id }, data: scalarUpdate });
    }

    // Re-sequence affected sibling groups.
    if (isMove) {
      // Old group lost a member; renumber it. New group gains the target at the
      // requested index (or the end).
      await resequenceSiblings(tx, existing.parentId);
      await placeWithinSiblings(tx, newParentId, id, data.displayOrder);
    } else if (data.displayOrder !== undefined) {
      await placeWithinSiblings(tx, existing.parentId, id, data.displayOrder);
    }

    return tx.category.findUniqueOrThrow({ where: { id } });
  });
}

// ---------------------------------------------------------------------------
// DELETE /api/categories/:id — reassign entries OR cascade subtree (Q18)
// ---------------------------------------------------------------------------

/**
 * Delete a category and its entire subtree of descendant categories. The fate
 * of the entries contained anywhere in that subtree depends on `mode` (Q18):
 *
 *   - `reassign`: every subtree entry is moved to `reassignToCategoryId`
 *     (which must exist and must not lie inside the subtree) before the
 *     categories are removed — no entries are lost (Property 9).
 *   - `cascade`: every subtree entry is deleted through Prisma so the FTS5
 *     sync triggers fire and `EntryFts` (plus cascaded definitions/examples/
 *     images) stay consistent; afterwards no entries from the subtree remain.
 *
 * The whole operation runs in one transaction (NFR 3.2). After deletion the
 * former parent's sibling group is renumbered (Property 8).
 *
 * NOTE on reassign + duplicates: the `@@unique([word, categoryId])` constraint
 * still applies, so reassigning an entry whose `word` already exists in the
 * target category will fail the transaction with a 409-style conflict rather
 * than silently merging — surfacing the collision to the caller.
 */
export async function deleteCategory(
  client: PrismaClient,
  id: number,
  request: DeleteCategoryRequest,
): Promise<DeleteCategoryResult> {
  return client.$transaction(async (tx) => {
    const existing = await tx.category.findUnique({ where: { id } });
    if (!existing) throw notFoundError();

    const all = await tx.category.findMany({
      select: { id: true, parentId: true },
    });
    const subtreeIds = collectSubtreeIds(all, id);

    let affectedEntryCount = 0;

    if (request.mode === 'reassign') {
      const targetId = request.reassignToCategoryId;
      if (targetId === undefined) {
        throw fieldError(
          400,
          'reassignToCategoryId',
          'reassignToCategoryId is required when mode is "reassign".',
        );
      }
      if (subtreeIds.includes(targetId)) {
        throw fieldError(
          400,
          'reassignToCategoryId',
          'Cannot reassign entries to the category being deleted or one of its descendants.',
        );
      }
      const target = await tx.category.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!target) {
        throw fieldError(
          400,
          'reassignToCategoryId',
          'Target category does not exist.',
        );
      }

      try {
        const moved = await tx.entry.updateMany({
          where: { categoryId: { in: subtreeIds } },
          data: { categoryId: targetId },
        });
        affectedEntryCount = moved.count;
      } catch (err) {
        // Unique (word, categoryId) collision with an existing target entry.
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code?: string }).code === 'P2002'
        ) {
          throw new CategoryError(409, {
            error: 'Duplicate entry',
            fieldErrors: [
              {
                field: 'reassignToCategoryId',
                message:
                  'Reassigning would create a duplicate (word + category) in the target category.',
              },
            ],
          });
        }
        throw err;
      }
    } else {
      // cascade: delete through Prisma so FTS5 triggers fire per row.
      const deleted = await tx.entry.deleteMany({
        where: { categoryId: { in: subtreeIds } },
      });
      affectedEntryCount = deleted.count;
    }

    // Remove the subtree categories. Entries are already moved/deleted, so the
    // Entry → Category RESTRICT foreign key is satisfied.
    await tx.category.deleteMany({ where: { id: { in: subtreeIds } } });

    // Renumber the former parent's remaining children (Property 8).
    await resequenceSiblings(tx, existing.parentId);

    const result: DeleteCategoryResult = {
      mode: request.mode,
      deletedCategoryIds: subtreeIds,
      affectedEntryCount,
    };
    if (request.mode === 'reassign') {
      result.reassignedToCategoryId = request.reassignToCategoryId;
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// DELETE request validation (Q18 — explicit mode required)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a `DELETE /api/categories/:id` body. `mode` is REQUIRED (Q18: the
 * owner must explicitly choose reassign vs cascade — there is no default). When
 * `mode === 'reassign'`, `reassignToCategoryId` must be a positive integer; its
 * existence is checked against the database in `deleteCategory`.
 */
export function validateDeleteCategory(
  input: unknown,
): ValidationResult<DeleteCategoryRequest> {
  const errors: FieldError[] = [];
  if (!isPlainObject(input)) {
    return {
      success: false,
      errors: [
        {
          field: 'mode',
          message:
            'A deletion mode is required: "reassign" or "cascade".',
        },
      ],
    };
  }

  const mode = input.mode;
  if (mode !== 'reassign' && mode !== 'cascade') {
    errors.push({
      field: 'mode',
      message: 'mode must be either "reassign" or "cascade".',
    });
  }

  let reassignToCategoryId: number | undefined;
  if (mode === 'reassign') {
    const target = input.reassignToCategoryId;
    if (
      typeof target !== 'number' ||
      !Number.isInteger(target) ||
      target <= 0
    ) {
      errors.push({
        field: 'reassignToCategoryId',
        message:
          'reassignToCategoryId must be a positive integer when mode is "reassign".',
      });
    } else {
      reassignToCategoryId = target;
    }
  }

  if (errors.length > 0) return { success: false, errors };

  const data: DeleteCategoryRequest = { mode: mode as DeleteCategoryRequest['mode'] };
  if (reassignToCategoryId !== undefined) {
    data.reassignToCategoryId = reassignToCategoryId;
  }
  return { success: true, data };
}
