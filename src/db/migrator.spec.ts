import type { MigrationMeta } from 'drizzle-orm/migrator';
import { migrateEach, type MigrationTarget } from './migrator';

/**
 * Applying migrations one transaction at a time.
 *
 * The SQL and the journal table are drizzle's, and `pnpm migrate` against a
 * fresh database proves them (CI does it on every push). What is tested here is
 * the order and the boundaries: which migrations run, in what order, and that
 * one failing leaves everything before it committed.
 */

const migration = (folderMillis: number): MigrationMeta => ({
  sql: [`-- ${folderMillis}`],
  bps: true,
  folderMillis,
  hash: `hash-${folderMillis}`,
});

const JOURNAL = [100, 200, 300, 400].map(migration);

/** A database that records what was applied, and can refuse one migration. */
function fakeTarget(lastAppliedAt: number | null, failsAt?: number) {
  const applied: number[] = [];
  const target: MigrationTarget = {
    prepare: () => Promise.resolve(),
    lastAppliedAt: () => Promise.resolve(lastAppliedAt),
    applyOne: (m) => {
      if (m.folderMillis === failsAt) {
        return Promise.reject(new Error(`migration ${m.folderMillis} failed`));
      }
      applied.push(m.folderMillis);
      return Promise.resolve();
    },
  };
  return { target, applied };
}

describe('migrateEach', () => {
  it('applies every migration to a fresh database, in journal order', async () => {
    const { target, applied } = fakeTarget(null);
    expect(await migrateEach(target, JOURNAL)).toBe(4);
    expect(applied).toEqual([100, 200, 300, 400]);
  });

  // drizzle's own rule, so a database it migrated carries on from here.
  it('applies only what is newer than the last migration applied', async () => {
    const { target, applied } = fakeTarget(200);
    expect(await migrateEach(target, JOURNAL)).toBe(2);
    expect(applied).toEqual([300, 400]);
  });

  it('does nothing to a database that is up to date', async () => {
    const { target, applied } = fakeTarget(400);
    expect(await migrateEach(target, JOURNAL)).toBe(0);
    expect(applied).toEqual([]);
  });

  // The point of the whole runner: what committed before a failure stays
  // committed, and nothing after it runs — so a rerun resumes from the failure
  // instead of from an empty schema.
  it('keeps the migrations before a failure, and runs none after it', async () => {
    const { target, applied } = fakeTarget(null, 300);
    await expect(migrateEach(target, JOURNAL)).rejects.toThrow(
      'migration 300 failed',
    );
    expect(applied).toEqual([100, 200]);
  });

  it('reports each migration once it has committed', async () => {
    const { target } = fakeTarget(100);
    const reported: number[] = [];
    await migrateEach(target, JOURNAL, (m) => reported.push(m.folderMillis));
    expect(reported).toEqual([200, 300, 400]);
  });

  it('prepares the journal before asking what it holds', async () => {
    const calls: string[] = [];
    const target: MigrationTarget = {
      prepare: () => (calls.push('prepare'), Promise.resolve()),
      lastAppliedAt: () => (calls.push('lastAppliedAt'), Promise.resolve(null)),
      applyOne: () => (calls.push('applyOne'), Promise.resolve()),
    };
    await migrateEach(target, [migration(100)]);
    expect(calls).toEqual(['prepare', 'lastAppliedAt', 'applyOne']);
  });
});
