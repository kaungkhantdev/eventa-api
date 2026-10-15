import {
  PERM_AUDIT_TYPE,
  memberRoleChangeAudit,
  roleCreatedAudit,
  rolePermissionsAudit,
} from './permission-change.audit';

/*
 * US-SET-05: "Given a teammate's role was changed, when I open the audit log,
 * then I see an entry showing who changed it, from which role to which, and
 * when." US-SET-12: "Given sensitive capabilities (like exporting attendee
 * data or issuing refunds) are granted, when saved, then the grant is clearly
 * flagged in the record." The who and the when are the row's actor and time;
 * these are the words the row carries.
 */
describe('permission change audit entries', () => {
  it('records role changes as the perm audit type', () => {
    expect(PERM_AUDIT_TYPE).toBe('perm');
  });

  describe('a member moved to another role', () => {
    it('names the member and both roles', () => {
      const entry = memberRoleChangeAudit(
        'Nok',
        { name: 'Staff', permissions: ['regView', 'regCheckin'] },
        { name: 'Organizer', permissions: ['regView', 'evCreate'] },
      );

      expect(entry).toEqual({
        title: "Changed Nok's role from Staff to Organizer",
        meta: null,
      });
    });

    it('flags a sensitive capability the new role brings', () => {
      const entry = memberRoleChangeAudit(
        'Nok',
        { name: 'Staff', permissions: ['regView'] },
        { name: 'Finance', permissions: ['regView', 'finRefund'] },
      );

      expect(entry.title).toBe(
        "Changed Nok's role from Staff to Finance — sensitive access granted",
      );
      expect(entry.meta).toBe('Sensitive: Issue refunds');
    });

    it('does not flag a sensitive capability the member already had', () => {
      const entry = memberRoleChangeAudit(
        'Nok',
        { name: 'Exports', permissions: ['regExport', 'regView'] },
        { name: 'Organizer', permissions: ['regExport', 'evCreate'] },
      );

      expect(entry.title).toBe("Changed Nok's role from Exports to Organizer");
      expect(entry.meta).toBeNull();
    });
  });

  describe("a role's permissions edited", () => {
    it('lists what was granted and what was revoked', () => {
      const entry = rolePermissionsAudit(
        'Staff',
        ['regView', 'finView'],
        ['regView', 'regCheckin'],
      );

      expect(entry).toEqual({
        title: 'Changed the permissions of the Staff role',
        meta: 'Granted: Check attendees in · Revoked: View payments & payouts',
      });
    });

    it('clearly flags a sensitive grant', () => {
      const entry = rolePermissionsAudit(
        'Staff',
        ['regView'],
        ['regView', 'regExport', 'finRefund'],
      );

      expect(entry?.title).toBe(
        'Changed the permissions of the Staff role — sensitive access granted',
      );
      expect(entry?.meta).toBe(
        'Granted: Export attendee data (sensitive), Issue refunds (sensitive)',
      );
    });

    it('does not flag revoking a sensitive capability', () => {
      const entry = rolePermissionsAudit('Staff', ['finRefund'], []);

      expect(entry).toEqual({
        title: 'Changed the permissions of the Staff role',
        meta: 'Revoked: Issue refunds',
      });
    });

    it('records nothing when a save changes nothing', () => {
      expect(
        rolePermissionsAudit('Staff', ['regView'], ['regView']),
      ).toBeNull();
    });
  });

  describe('a role created', () => {
    it('names the role and what it grants, flagging sensitive grants', () => {
      expect(
        roleCreatedAudit('Volunteer', ['regCheckin', 'regExport']),
      ).toEqual({
        title: 'Created the Volunteer role — sensitive access granted',
        meta: 'Granted: Check attendees in, Export attendee data (sensitive)',
      });
    });

    it('records a role created with nothing granted', () => {
      expect(roleCreatedAudit('Empty', [])).toEqual({
        title: 'Created the Empty role',
        meta: null,
      });
    });
  });
});
