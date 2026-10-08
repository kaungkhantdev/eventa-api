/** Postgres SQLSTATE for a unique constraint or index violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Did this rejection come from one particular unique index?
 *
 * A service that checks "is this name taken?" and then writes has a gap
 * between the two: two requests can both find the name free and both try to
 * take it. The index is what actually stops the second, and this is how that
 * refusal is turned back into the same answer the check would have given —
 * rather than a 500 that reads as a bug in the product.
 *
 * Named, never "any 23505". One statement can violate several constraints, and
 * answering a duplicate slug with "that workspace name is taken" would send
 * somebody to change a field that was never the problem.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const fields = error as
    { code?: unknown; constraint_name?: unknown } | null | undefined;
  return (
    typeof fields === 'object' &&
    fields !== null &&
    fields.code === UNIQUE_VIOLATION &&
    fields.constraint_name === constraint
  );
}

/** The index that keeps workspace names unique across the platform. */
export const UQ_ORGANIZATIONS_NAME = 'uq_organizations_name';
