export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * A page of results. Return this from a list endpoint; the response interceptor
 * renders it as `{ ...envelope, data: items, meta }`. Every paginated endpoint
 * therefore emits the same `meta` shape.
 */
export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: PageMeta,
  ) {}

  static of<T>(
    items: T[],
    total: number,
    page: number,
    limit: number,
  ): Paginated<T> {
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
    return new Paginated(items, {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    });
  }
}
