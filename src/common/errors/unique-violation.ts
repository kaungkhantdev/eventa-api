import { pgFields } from './pg-error';

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
  const pg = pgFields(error);
  return pg?.code === UNIQUE_VIOLATION && pg.constraint === constraint;
}

/** The index that keeps workspace names unique across the platform. */
export const UQ_ORGANIZATIONS_NAME = 'uq_organizations_name';

/**
 * One email address per attendee per workspace.
 *
 * It carries NO `WHERE deleted_at IS NULL` predicate, so a removed attendee
 * still owns its address — which is why US-REG-08's collision check counts
 * soft-deleted records too, and why this name is needed to turn the index's own
 * refusal of a racing write back into the same merge prompt.
 */
export const UQ_ATTENDEES_ORG_EMAIL = 'uq_attendees_org_email';
