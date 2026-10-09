import type { Database } from '../../db/drizzle.constants';
import { SurveysRepository } from './surveys.repository';
import type { DraftQuestion } from './survey-rules';

const QUESTIONS: DraftQuestion[] = [
  { type: 'rating', prompt: 'How was it?', options: [] },
];

/**
 * A transaction that records what was asked of it.
 *
 * `claimed` is what the compare-and-swap returns: a row when the version
 * matched, nothing when somebody else has saved since.
 */
function fakeTx(claimed: { id: number }[]) {
  const seen = { deletes: 0, inserted: [] as unknown[] };
  const tx = {
    execute: () => Promise.resolve(undefined),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve(claimed) }),
      }),
    }),
    delete: () => {
      seen.deletes += 1;
      return { where: () => Promise.resolve(undefined) };
    },
    insert: () => ({
      values: (rows: unknown) => {
        seen.inserted.push(rows);
        return Promise.resolve(undefined);
      },
    }),
  };
  const db = {
    transaction: (work: (t: unknown) => Promise<unknown>) => work(tx),
  } as unknown as Database;
  return { db, seen };
}

describe('SurveysRepository.update', () => {
  /*
   * THE PROPERTY THE WHOLE FIX RESTS ON, and it had no test: the questions are
   * stored by REPLACEMENT — every row deleted, the submitted set re-inserted —
   * so a stale save that is refused only after the delete has destroyed another
   * organizer's question anyway. Reporting the conflict afterwards would leave
   * a rollback as the only thing between a refusal and data loss.
   *
   * Removing the guard that enforces this order left all 50 survey tests green,
   * which is why this exists.
   */
  it('deletes nothing when the version has moved on', async () => {
    const { db, seen } = fakeTx([]);

    const saved = await new SurveysRepository(db).update(
      7,
      12,
      { title: 'Edited', questions: QUESTIONS },
      4,
    );

    expect(saved).toBe(false);
    expect(seen.deletes).toBe(0);
    expect(seen.inserted).toHaveLength(0);
  });

  it('replaces the questions when the version still matches', async () => {
    const { db, seen } = fakeTx([{ id: 12 }]);

    const saved = await new SurveysRepository(db).update(
      7,
      12,
      { title: 'Edited', questions: QUESTIONS },
      4,
    );

    expect(saved).toBe(true);
    expect(seen.deletes).toBe(1);
    expect(seen.inserted).toHaveLength(1);
  });
});
