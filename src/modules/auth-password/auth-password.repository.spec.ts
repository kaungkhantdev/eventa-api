import type { Database } from '../../db/drizzle.constants';
import type { OutboxPort } from '../platform/outbox.port';
import { PasswordRepository } from './auth-password.repository';

/**
 * A transaction that records what it was asked to do.
 *
 * `revoked` is what the revoke statement returns — the rows it actually
 * matched, which is the number the member's email then quotes at them.
 */
function fakeTx(revoked: { id: string }[]) {
  const seen = { enqueued: [] as unknown[] };
  const tx = {
    execute: () => Promise.resolve(undefined),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(revoked),
          then: (r: (v: unknown) => unknown) =>
            Promise.resolve(undefined).then(r),
        }),
      }),
    }),
  };
  const db = {
    transaction: (work: (t: unknown) => Promise<unknown>) => work(tx),
  } as unknown as Database;
  const outbox = {
    enqueueIn: (_tx: unknown, event: unknown) => {
      seen.enqueued.push(event);
      return Promise.resolve(undefined);
    },
  } as unknown as OutboxPort;
  return { db, outbox, seen };
}

describe('PasswordRepository.setPassword', () => {
  /*
   * The outbox write is the whole point of the change that added it, and it
   * had no guard: deleting the `enqueueIn` call left all 160 suites green,
   * because the service spec only checks that a builder is HANDED to this
   * method, never that this method calls it.
   */
  it('writes the notice in the same transaction as the password', async () => {
    const { db, outbox, seen } = fakeTx([{ id: 's-1' }, { id: 's-2' }]);
    const repo = new PasswordRepository(db, outbox);

    await repo.setPassword(
      7,
      'u-1',
      'hash',
      undefined,
      (count) =>
        ({
          count,
        }) as never,
    );

    expect(seen.enqueued).toHaveLength(1);
  });

  /*
   * And it must quote the rows the statement really matched. This number is
   * the one thing in a security notice a reader uses to judge how far somebody
   * else already was, so an inflated one is worse than none.
   */
  it('tells the notice how many sign-ins were actually revoked', async () => {
    const { db, outbox, seen } = fakeTx([{ id: 's-1' }, { id: 's-2' }]);
    const repo = new PasswordRepository(db, outbox);

    await repo.setPassword(
      7,
      'u-1',
      'hash',
      undefined,
      (count) =>
        ({
          count,
        }) as never,
    );

    expect(seen.enqueued[0]).toEqual({ count: 2 });
  });

  it('still changes the password when no notice was asked for', async () => {
    const { db, outbox, seen } = fakeTx([]);
    const repo = new PasswordRepository(db, outbox);

    await expect(repo.setPassword(7, 'u-1', 'hash')).resolves.toBeUndefined();
    expect(seen.enqueued).toHaveLength(0);
  });
});
