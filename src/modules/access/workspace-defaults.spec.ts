import { DEFAULT_ROLES, PERMISSION_CATALOG } from './workspace-defaults';

/**
 * The matrix a new workspace is provisioned from.
 *
 * It is applied once, the day the workspace is created, and nothing tops it up
 * afterwards: a key added to the catalog later is reported to the organizer as
 * a gap (`neverOfferedPermissions`) for them to decide about, because two
 * attempts at granting it automatically both reversed decisions organizers had
 * already made. That makes this matrix the only place the product states what a
 * built-in role starts with, so the statements it makes are worth pinning.
 */
describe('DEFAULT_ROLES', () => {
  const grantsOf = (name: string) =>
    DEFAULT_ROLES.find((role) => role.name === name)?.grants ?? [];

  it('gives Admin the whole catalog, because "Full access" means all of it', () => {
    expect([...grantsOf('Admin')].sort()).toEqual(
      PERMISSION_CATALOG.map((p) => p.key).sort(),
    );
  });

  // Finance is the one that matters: Organizer may see payments and set
  // discounts, but voiding an invoice or filing VAT is an Admin's job.
  it('keeps finManage to Admin, and does not lend it to Organizer or Staff', () => {
    expect(grantsOf('Admin')).toContain('finManage');
    expect(grantsOf('Organizer')).not.toContain('finManage');
    expect(grantsOf('Staff')).not.toContain('finManage');
  });

  // A key that is not in the catalog cannot satisfy `role_permissions`' foreign
  // key, so a typo here would fail at the database on the next sign-up rather
  // than in a test.
  it('names only keys the catalog actually has', () => {
    const catalog = PERMISSION_CATALOG.map((p) => p.key);

    for (const role of DEFAULT_ROLES) {
      expect(catalog).toEqual(expect.arrayContaining([...role.grants]));
    }
  });

  it('has a role for the workspace owner to be given', () => {
    expect(DEFAULT_ROLES.map((role) => role.name)).toContain('Admin');
  });
});
