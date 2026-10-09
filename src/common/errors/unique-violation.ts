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

/**
 * How deep to follow `cause` before giving up.
 *
 * Two is all the stack produces today — drizzle wrapping pg — and a bound
 * rather than a `while` so a self-referential `cause` cannot spin here.
 */
const MAX_CAUSE_DEPTH = 5;

/**
 * The node-postgres error inside whatever threw, or null.
 *
 * TWO LAYERS, and reading either one wrong makes this guard silently always
 * false — which is what it was. Both are verified against the installed
 * packages rather than assumed:
 *
 * - **The field is `constraint`, not `constraint_name`.** `pg-protocol`'s
 *   parser builds the error with `message.constraint = fields.n`; no
 *   `constraint_name` exists anywhere on it. This file asked for the latter.
 * - **Drizzle wraps every query rejection.** `drizzle-orm/pg-core/session`
 *   does `throw new DrizzleQueryError(queryString, params, e)`, so the pg error
 *   sits at `.cause` and the object actually caught carries no `code` at all.
 *
 * Both wrong at once is why the three callers — the workspace rename, signup,
 * and the attendee contact edit — never once turned an index race back into the
 * answer their pre-check would have given. They answered 500 instead.
 *
 * AND THAT 500 LEAKED. `DrizzleQueryError`'s message is
 * `Failed query: <sql>
params: <bound values>`, and the global filter logs
 * `exception.stack` for a 5xx — so a racing attendee edit wrote that person's
 * name, email and phone into the application log, which is precisely the
 * disclosure the attendee service keeps out of its 409 message on purpose.
 *
 * So the chain is walked rather than the wrapper special-cased: it costs
 * nothing, it keeps working if drizzle stops wrapping or starts wrapping twice,
 * and a raw `pool.query` that never passed through drizzle still works.
 */
function pgFields(
  error: unknown,
): { code?: unknown; constraint?: unknown } | null {
  let current = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    const fields = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (typeof fields.code === 'string') return fields;
    current = fields.cause;
  }
  return null;
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
