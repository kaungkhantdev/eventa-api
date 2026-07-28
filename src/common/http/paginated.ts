export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * A page of results. Return this from a list endpoint; the response interceptor
 * renders it as `{ data: items, meta }`.
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
    pageSize: number,
  ): Paginated<T> {
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    return new Paginated(items, { page, pageSize, total, totalPages });
  }
}
