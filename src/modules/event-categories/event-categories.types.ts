import type { categories } from '../../db/schema';

/** A selected `categories` row. */
export type CategoryRow = typeof categories.$inferSelect;
/** A `categories` insert shape. */
export type NewCategoryValues = typeof categories.$inferInsert;
/** The category swatch (`category_color` enum). */
export type CategoryColor = CategoryRow['color'];

/** A category with its live count of events (derived). */
export interface CategoryWithCount extends CategoryRow {
  eventCount: number;
}

/** `name` A–Z (default) or `recent` (newest first). */
export type CategorySort = 'name' | 'recent';

/** Query for the category list (mapped from the query DTO). */
export interface ListCategoriesQuery {
  page?: number;
  limit?: number;
  q?: string;
  sort?: CategorySort;
}

/** Normalized list options handed to the repository. */
export interface ListCategoriesOptions {
  limit: number;
  offset: number;
  sort: CategorySort;
  q?: string;
}

/** Service input to create a category. */
export interface CreateCategoryInput {
  name: string;
  icon: string;
  color: CategoryColor;
  description?: string;
}

/** Service input to update a category (undefined = leave as-is). */
export interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  color?: CategoryColor;
  description?: string | null;
  /** Optimistic-concurrency token; when set, must match the current row. */
  version?: number;
}
