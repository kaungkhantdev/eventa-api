import { safeError } from './safe-error';

/**
 * What may be written about a failure.
 *
 * Nine places logged `{ err }` — the raw error — and pino's serializer writes
 * an error's message, its stack and every own enumerable property. Two error
 * classes reaching those sites carry personal data in exactly those places:
 *
 * - **ioredis names the command it was running.** From the installed source
 *   (ioredis@5.11.1/built/DataHandler.js:40 and redis/event_handler.js:107):
 *   `err.command = { name: item.command.name, args: item.command.args }`.
 *   The throttles key on the sign-in identity, so `args[0]` is
 *   `login:lock:<realm>|<persona>|somchai@example.com` — and those call sites
 *   are the fail-open catch blocks, which run precisely when Redis is sick.
 * - **Drizzle wraps every query rejection**, putting the statement and its
 *   bound values in the message (see `pg-error.ts`).
 *
 * So nothing is spread: a fixed, known set of fields is built instead.
 */
describe('safeError', () => {
  const EMAIL = 'somchai@example.com';

  /** Exactly as ioredis builds it when a command fails mid-flight. */
  function redisFailure(): Error {
    return Object.assign(new Error('Connection is closed.'), {
      command: { name: 'ttl', args: [`login:lock:acme|admin|${EMAIL}`] },
    });
  }

  describe('a Redis failure', () => {
    it('does not carry the key, which is keyed on the person', () => {
      expect(JSON.stringify(safeError(redisFailure()))).not.toContain(EMAIL);
    });

    it('carries none of the error’s own properties through', () => {
      const safe: Record<string, unknown> = { ...safeError(redisFailure()) };

      expect(safe.command).toBeUndefined();
    });

    /** Still diagnosable — this is the line that says Redis is down. */
    it('keeps what actually went wrong', () => {
      expect(safeError(redisFailure()).reason).toBe('Connection is closed.');
    });
  });

  describe('a failed query', () => {
    const BUYER = 'Somchai Jaidee';

    function queryFailure(): Error {
      const err = new Error(
        `Failed query: insert into "orders" ("buyer_name") values ($1)\nparams: ${BUYER}`,
      );
      err.stack = `${err.message}\n    at OrdersRepository.create (orders.ts:40:7)`;
      err.cause = Object.assign(new Error('deadlock'), {
        code: '40P01',
        constraint: 'orders_pkey',
      });
      return err;
    }

    it('says what the database refused, not what was bound', () => {
      const safe = safeError(queryFailure());

      expect(JSON.stringify(safe)).not.toContain(BUYER);
      expect(JSON.stringify(safe)).not.toContain('insert into');
      expect(safe.code).toBe('40P01');
    });

    it('keeps the frames', () => {
      expect(safeError(queryFailure()).at).toContain('OrdersRepository.create');
    });
  });

  describe('an ordinary failure', () => {
    /** Over-redacting hides the outages a log exists to show. */
    it('keeps its own words', () => {
      expect(
        safeError(new Error('connect ECONNREFUSED 127.0.0.1:6379')).reason,
      ).toContain('ECONNREFUSED 127.0.0.1:6379');
    });

    it('masks an address that appears in the message itself', () => {
      expect(safeError(new Error(`rejected <${EMAIL}>`)).reason).not.toContain(
        EMAIL,
      );
    });

    it('survives something that is not an Error at all', () => {
      expect(safeError('plain string').reason).toBe('plain string');
      expect(safeError(undefined).name).toBe('unknown');
    });
  });
});
