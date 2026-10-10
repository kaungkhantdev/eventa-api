import { pgFields } from './pg-error';

/**
 * A failure, in terms that are safe to put in a log.
 *
 * WHY NOT `{ err }`. pino's serializer writes an error's message, its stack
 * and every own enumerable property, and two error classes that reach this
 * API's log sites carry personal data in exactly those places:
 *
 * - **ioredis names the command it was running.** Verified against the
 *   installed source (ioredis@5.11.1/built/DataHandler.js:40, and
 *   `abortError` in redis/event_handler.js:107):
 *   `err.command = { name: item.command.name, args: item.command.args }`.
 *   Both throttles key on the sign-in identity, so `args[0]` is
 *   `login:lock:<realm>|<persona>|<email>` — and the catch blocks that log it
 *   are the FAIL-OPEN ones, which run exactly when Redis is unwell.
 * - **Drizzle wraps every query rejection**, putting the statement and every
 *   bound value in the message — see `pg-error.ts`.
 *
 * So nothing is spread: this builds a fixed, known set of fields instead.
 * Adding a property to an error can never widen what gets logged.
 */
export interface SafeError {
  /** The error's class, so failure kinds can be counted. */
  name: string;
  /** SQLSTATE, where the failure came from Postgres. */
  code?: string;
  /** What went wrong, with addresses masked and no statement in it. */
  reason: string;
  /** The stack FRAMES — where it happened, which carries nothing personal. */
  at?: string;
}

/** How Drizzle opens the message of every query it wraps (see `pg-error.ts`). */
const DRIZZLE_MESSAGE_PREFIX = 'Failed query:';

/** A stack frame line, which is the part of a stack worth keeping. */
const FRAME = /^\s+at\s/;

/**
 * Anything shaped like an email address.
 *
 * Deliberately greedy: a false positive costs one masked word in a log line,
 * a false negative is somebody's address in it. Honest about the limit — this
 * masks ADDRESSES, not names, which is why the query branch below drops its
 * message outright rather than trying to mask it.
 */
const EMAIL = /[^\s<>,;:"']+@[^\s<>,;:"']+/g;
const MASKED = '[address]';

export function safeError(cause: unknown): SafeError {
  if (!(cause instanceof Error)) {
    return { name: 'unknown', reason: mask(String(cause)) };
  }
  const pg = pgFields(cause);
  const at = frames(cause);
  if (cause.message.startsWith(DRIZZLE_MESSAGE_PREFIX)) {
    // The message IS the statement and its parameters. Nothing in it is worth
    // keeping, so it is replaced rather than masked.
    const constraint = pg?.constraint ? ` (${pg.constraint})` : '';
    return {
      name: cause.name,
      code: pg?.code,
      reason: `query failed${constraint}`,
      at,
    };
  }
  return { name: cause.name, code: pg?.code, reason: mask(cause.message), at };
}

function frames(cause: Error): string | undefined {
  const lines = (cause.stack ?? '').split('\n').filter((l) => FRAME.test(l));
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function mask(text: string): string {
  return text.replace(EMAIL, MASKED);
}
