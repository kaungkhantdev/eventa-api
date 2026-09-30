import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_ROLES,
  KEYS_ADDED_AFTER_PROVISIONING,
  PERMISSION_CATALOG,
  backfillableGrantsForSystemRole,
  grantsForSystemRole,
} from './workspace-defaults';

/**
 * The lookup the backfill is generated from.
 *
 * A workspace receives its built-in roles once, the day it is created, so a
 * permission key added to the catalog afterwards never reaches the workspaces
 * that already existed. Reconciling that gap means asking, for a role, which
 * keys it was always meant to hold — and the answer has to come from the same
 * `DEFAULT_ROLES` matrix that provisioning uses, or the two drift and a role
 * created tomorrow differs from the same role reconciled today.
 */
describe('grantsForSystemRole', () => {
  it('gives Admin the whole catalog, because "Full access" means all of it', () => {
    expect([...grantsForSystemRole('Admin')].sort()).toEqual(
      PERMISSION_CATALOG.map((p) => p.key).sort(),
    );
  });

  it.each(DEFAULT_ROLES.map((r) => [r.name, r.grants] as const))(
    'answers for %s exactly what provisioning would have granted',
    (name, grants) => {
      expect([...grantsForSystemRole(name)].sort()).toEqual([...grants].sort());
    },
  );

  // Finance is the one that matters: Organizer may see payments and set
  // discounts, but voiding an invoice or filing VAT is an Admin's job. A
  // reconcile that handed every role the same keys would be an escalation
  // nobody asked for.
  it('keeps finManage to Admin, and does not lend it to Organizer or Staff', () => {
    expect(grantsForSystemRole('Admin')).toContain('finManage');
    expect(grantsForSystemRole('Organizer')).not.toContain('finManage');
    expect(grantsForSystemRole('Staff')).not.toContain('finManage');
  });

  // The name is all the reconcile has to go on, so a workspace that named its
  // own role "Volunteer" must come back with nothing rather than a guess.
  it('has nothing to say about a name that is not a built-in', () => {
    expect(grantsForSystemRole('Volunteer')).toEqual([]);
  });
});

/**
 * What a reconcile is allowed to put back, which is narrower than what the role
 * was meant to hold.
 *
 * A revoke used to DELETE the row, so for every key that existed before that
 * changed, "the organizer took this away" and "this workspace was never offered
 * it" are the same absence on disk. The only keys a reconcile can fill in
 * without risking the first are the ones no workspace can ever have been
 * offered — the keys added to the catalog after the built-in roles are handed
 * out. Everything else has to be left alone, however plainly it belongs to the
 * role's defaults.
 */
describe('backfillableGrantsForSystemRole', () => {
  it('gives Admin only the keys added after it was provisioned, not its whole catalog', () => {
    expect([...backfillableGrantsForSystemRole('Admin')].sort()).toEqual(
      ['evProgramView', 'finManage', 'regManage'].sort(),
    );
  });

  // The escalation the migration's comment names: Organizer may see payments
  // and set discounts, but voiding an invoice is an Admin's job, so a reconcile
  // that ignored which role it was filling would invent an escalation.
  it('gives Organizer the two it is owed, and still not finManage', () => {
    expect([...backfillableGrantsForSystemRole('Organizer')].sort()).toEqual(
      ['evProgramView', 'regManage'].sort(),
    );
  });

  it('gives Staff the one key of the three that is in its defaults', () => {
    expect(backfillableGrantsForSystemRole('Staff')).toEqual(['evProgramView']);
  });

  it('has nothing to say about a name that is not a built-in', () => {
    expect(backfillableGrantsForSystemRole('Volunteer')).toEqual([]);
  });

  // A key that is not in the catalog cannot satisfy `role_permissions`'
  // foreign key, so a typo here would fail at the database rather than in a
  // test, and only for the workspaces the reconcile happened to reach.
  it('names only keys the catalog actually has', () => {
    const catalog = PERMISSION_CATALOG.map((p) => p.key);

    expect(catalog).toEqual(
      expect.arrayContaining([...KEYS_ADDED_AFTER_PROVISIONING]),
    );
  });

  /**
   * The runtime reconcile and the one-off migration have to agree.
   *
   * `0067` is the same backfill for the workspaces that exist today, and it was
   * deliberately restricted to these three keys for the reason above. Nothing
   * else ties the two together, so a reconcile widened to the full defaults
   * would be strictly more dangerous than the migration beside it while looking
   * like the same change. Comparing the pairs is what records that.
   */
  it('writes exactly the pairs migration 0067 writes', () => {
    const generated = DEFAULT_ROLES.flatMap(({ name }) =>
      backfillableGrantsForSystemRole(name).map((key) => `${name},${key}`),
    );

    expect(generated.sort()).toEqual(migrationPairs().sort());
  });
});

/** The `(role, key)` pairs migration 0067 inserts, read from the migration itself. */
function migrationPairs(): string[] {
  const sql = readFileSync(
    join(__dirname, '../../db/migrations/0067_backfill_system_role_grants.sql'),
    'utf8',
  );
  return [...sql.matchAll(/\('(\w+)',\s*'(\w+)'\)/g)].map(
    ([, role, key]) => `${role},${key}`,
  );
}
