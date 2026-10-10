/**
 * Reading what Postgres actually said, through whatever wrapped it.
 *
 * Shared because getting it wrong is silent and has cost this codebase twice:
 * `isUniqueViolation` read `constraint_name` on the wrapper and was always
 * false, and the global filter printed the wrapper's message — which carries
 * the bound parameters — into every 5xx log.
 */

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
 * TWO LAYERS, and reading either one wrong makes a guard built on this
 * silently always false. Both are verified against the installed packages
 * rather than assumed:
 *
 * - **The field is `constraint`, not `constraint_name`.** `pg-protocol`'s
 *   parser builds the error with `message.constraint = fields.n`; no
 *   `constraint_name` exists anywhere on it.
 * - **Drizzle wraps every query rejection.** `drizzle-orm/pg-core/session`
 *   does `throw new DrizzleQueryError(queryString, params, e)`, so the pg
 *   error sits at `.cause` and the object actually caught carries no `code`.
 *
 * The chain is walked rather than the wrapper special-cased: it costs nothing,
 * it keeps working if drizzle stops wrapping or starts wrapping twice, and a
 * raw `pool.query` that never passed through drizzle still works.
 */
export function pgFields(
  error: unknown,
): { code: string; constraint?: string } | null {
  let current = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    const fields = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (typeof fields.code === 'string') {
      return typeof fields.constraint === 'string'
        ? { code: fields.code, constraint: fields.constraint }
        : { code: fields.code };
    }
    current = fields.cause;
  }
  return null;
}

/**
 * How Drizzle opens the message of every query it wraps.
 *
 * Verified against the installed source (drizzle-orm/errors.cjs:36):
 *
 *     super(`Failed query: ${query}\nparams: ${params}`)
 *
 * so this prefix is the marker for "the rest of this message is a statement
 * and its bound values".
 */
const DRIZZLE_MESSAGE_PREFIX = 'Failed query:';

/** A stack frame line, which is the part of a stack worth keeping. */
const FRAME = /^\s+at\s/;

/**
 * A failed query's stack, with the statement and its parameters removed.
 *
 * Returns null when this is not a wrapped query error, so an ordinary failure
 * keeps its own words — over-redacting a log hides outages, and
 * "ECONNREFUSED 127.0.0.1:6379" carries nothing personal.
 *
 * What is dropped is the statement and every bound value; for the checkout
 * insert those are the buyer's name, email and phone. What is kept is where it
 * happened and what the database refused, which is what a 5xx log is for. A
 * statement and its parameters belong in a repro, not in production logs.
 */
export function redactedQueryStack(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (!error.message.startsWith(DRIZZLE_MESSAGE_PREFIX)) return null;

  const pg = pgFields(error);
  const code = typeof pg?.code === 'string' ? pg.code : 'unknown';
  const constraint =
    typeof pg?.constraint === 'string' ? ` (${pg.constraint})` : '';
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => FRAME.test(line));

  return [`${error.name}: query failed [${code}${constraint}]`, ...frames].join(
    '\n',
  );
}
