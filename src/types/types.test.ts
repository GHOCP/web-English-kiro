import { describe, it, expectTypeOf } from 'vitest';
import type { Category, Entry } from '@prisma/client';
import type {
  CategoryTree,
  CategoryTreeNode,
  CategoryViewType,
  EntryType,
  EntryWithRelations,
  CreateEntryRequest,
  UpdateEntryRequest,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  DeleteCategoryRequest,
  SearchResult,
  SearchResponse,
  ExportDocument,
  ExportFormat,
  HealthResponse,
} from './index';

/**
 * Compile-time contract tests for the shared types (Task 3).
 *
 * These assertions are checked by `tsc`/Vitest's type checker. They guard that
 * the domain types stay derived from Prisma's generated models and that the
 * API contracts keep the exact shapes specified in the design.
 *
 * Requirements: NFR 1.1, NFR 1.3
 */
describe('shared type contracts', () => {
  it('CategoryTreeNode extends the Prisma Category with recursive children', () => {
    expectTypeOf<CategoryTreeNode>().toMatchTypeOf<Category>();
    expectTypeOf<CategoryTreeNode['children']>().toEqualTypeOf<CategoryTreeNode[]>();
    expectTypeOf<CategoryTree>().toEqualTypeOf<CategoryTreeNode[]>();
  });

  it('EntryWithRelations is the Prisma Entry plus its relations', () => {
    expectTypeOf<EntryWithRelations>().toMatchTypeOf<Entry>();
    expectTypeOf<EntryWithRelations['definitions']>().toBeArray();
    expectTypeOf<EntryWithRelations['examples']>().toBeArray();
    expectTypeOf<EntryWithRelations['images']>().toBeArray();
    expectTypeOf<EntryWithRelations['category']>().toMatchTypeOf<Category>();
  });

  it('CreateEntryRequest matches the design contract', () => {
    expectTypeOf<CreateEntryRequest['word']>().toEqualTypeOf<string>();
    expectTypeOf<CreateEntryRequest['categoryId']>().toEqualTypeOf<number>();
    expectTypeOf<CreateEntryRequest['definitions']>().toBeArray();
    expectTypeOf<CreateEntryRequest['entryType']>().toEqualTypeOf<EntryType | undefined>();
    // A minimal valid request type-checks.
    const minimal: CreateEntryRequest = {
      word: 'provoke',
      categoryId: 1,
      definitions: [{ text: '激起，激发 to stimulate' }],
    };
    expectTypeOf(minimal).toMatchTypeOf<CreateEntryRequest>();
  });

  it('UpdateEntryRequest allows partial updates', () => {
    const patch: UpdateEntryRequest = { word: 'renamed' };
    expectTypeOf(patch).toMatchTypeOf<UpdateEntryRequest>();
  });

  it('Category request contracts carry the view/part-of-speech unions', () => {
    expectTypeOf<CreateCategoryRequest['name']>().toEqualTypeOf<string>();
    expectTypeOf<CreateCategoryRequest['viewType']>().toEqualTypeOf<
      CategoryViewType | undefined
    >();
    const update: UpdateCategoryRequest = { name: 'x', parentId: null };
    expectTypeOf(update).toMatchTypeOf<UpdateCategoryRequest>();
  });

  it('DeleteCategoryRequest enforces the reassign|cascade mode (Q18)', () => {
    expectTypeOf<DeleteCategoryRequest['mode']>().toEqualTypeOf<
      'reassign' | 'cascade'
    >();
    const reassign: DeleteCategoryRequest = {
      mode: 'reassign',
      reassignToCategoryId: 2,
    };
    const cascade: DeleteCategoryRequest = { mode: 'cascade' };
    expectTypeOf(reassign).toMatchTypeOf<DeleteCategoryRequest>();
    expectTypeOf(cascade).toMatchTypeOf<DeleteCategoryRequest>();
  });

  it('SearchResult matches the design contract', () => {
    expectTypeOf<SearchResult>().toEqualTypeOf<{
      entryId: number;
      word: string;
      categoryId: number;
      categoryName: string;
      snippet: string;
    }>();
    expectTypeOf<SearchResponse['results']>().toEqualTypeOf<SearchResult[]>();
  });

  it('Export types describe a round-trippable document', () => {
    expectTypeOf<ExportFormat>().toEqualTypeOf<'json' | 'csv' | 'markdown'>();
    expectTypeOf<ExportDocument['categories']>().toBeArray();
  });

  it('HealthResponse reports db status', () => {
    expectTypeOf<HealthResponse['status']>().toEqualTypeOf<'ok' | 'error'>();
    expectTypeOf<HealthResponse['database']>().toEqualTypeOf<'up' | 'down'>();
  });
});
