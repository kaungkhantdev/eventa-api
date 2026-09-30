import type { PermissionKey } from '../../common/decorators/require-permissions.decorator';

type PermGroup = 'Events' | 'Registrations' | 'Finance' | 'Settings';
type RoleName = 'Admin' | 'Organizer' | 'Staff';

/**
 * The global permission catalog (permission_key enum → group + label).
 *
 * This is the source of truth for the wording, and the `permissions` table is a
 * copy of it — see `ensureCatalog`, which reconciles rather than ignores. The
 * labels match `eventa-ui-kit/admin/roles.html`, because a permission's label
 * exists only to be read on that screen: "Ev create" is a key with a space in
 * it, not something to put in front of somebody deciding what a role may do.
 */
export const PERMISSION_CATALOG: {
  key: PermissionKey;
  group: PermGroup;
  label: string;
}[] = [
  { key: 'evCreate', group: 'Events', label: 'Create & edit events' },
  { key: 'evPublish', group: 'Events', label: 'Publish & cancel events' },
  { key: 'evSpeakers', group: 'Events', label: 'Manage speakers & agenda' },
  { key: 'evProgramView', group: 'Events', label: 'View agenda & speakers' },
  {
    key: 'regView',
    group: 'Registrations',
    label: 'View registrations & attendees',
  },
  { key: 'regCheckin', group: 'Registrations', label: 'Check attendees in' },
  { key: 'regExport', group: 'Registrations', label: 'Export attendee data' },
  {
    key: 'regManage',
    group: 'Registrations',
    label: 'Approve, add & invite registrations',
  },
  { key: 'finView', group: 'Finance', label: 'View payments & payouts' },
  { key: 'finRefund', group: 'Finance', label: 'Issue refunds' },
  { key: 'finDiscount', group: 'Finance', label: 'Manage discounts & pricing' },
  {
    key: 'finManage',
    group: 'Finance',
    label: 'Void invoices, payouts & VAT filing',
  },
  { key: 'setUsers', group: 'Settings', label: 'Manage users & roles' },
  { key: 'setSettings', group: 'Settings', label: 'Edit workspace settings' },
  { key: 'setIntegrations', group: 'Settings', label: 'Manage integrations' },
];

const ALL_KEYS = PERMISSION_CATALOG.map((p) => p.key);

/** The role the workspace owner (first registrant) is given. */
export const OWNER_ROLE: RoleName = 'Admin';

/** The default role set every new workspace starts with (editable later via RBAC). */
export const DEFAULT_ROLES: {
  name: RoleName;
  description: string;
  grants: PermissionKey[];
}[] = [
  { name: 'Admin', description: 'Full access', grants: ALL_KEYS },
  {
    name: 'Organizer',
    description: 'Events, program & registrations',
    grants: [
      'evCreate',
      'evPublish',
      'evSpeakers',
      'regView',
      'regCheckin',
      'regExport',
      'regManage',
      'finView',
      'finDiscount',
      'evProgramView',
    ],
  },
  {
    name: 'Staff',
    description: 'Check-in & registration view',
    grants: ['regView', 'regCheckin', 'evProgramView'],
  },
];

const GRANTS_BY_ROLE_NAME = new Map<string, readonly PermissionKey[]>(
  DEFAULT_ROLES.map((role) => [role.name, role.grants]),
);

/**
 * What a built-in role of this name was always meant to grant.
 *
 * A workspace is handed the matrix above once, the day it is created, so a key
 * added to the catalog later never reaches the workspaces that already exist.
 * Reconciling that gap needs the same answer provisioning gave — hence a lookup
 * over `DEFAULT_ROLES` rather than a second list, which would drift.
 *
 * A name that is not a built-in answers with nothing, which is what keeps a
 * workspace's own "Volunteer" out of the reconcile: the name is all it has to
 * go on, and there is no defensible guess.
 */
export function grantsForSystemRole(name: string): readonly PermissionKey[] {
  return GRANTS_BY_ROLE_NAME.get(name) ?? [];
}

/**
 * The catalog keys that post-date the built-in roles themselves.
 *
 * `insertDefaultRoles` hands a workspace its roles on the day it signs up, so a
 * key added to the catalog afterwards reaches nobody who was already here:
 * these three are missing from every workspace older than the migration that
 * introduced them, which is the gap the backfill exists to close.
 */
export const KEYS_ADDED_AFTER_PROVISIONING: readonly PermissionKey[] = [
  'finManage', // 0034
  'evProgramView', // 0038
  'regManage', // 0042
];

/**
 * What a reconcile may put back for a built-in role of this name.
 *
 * Narrower than `grantsForSystemRole` on purpose, and the narrowing is the
 * safety property rather than caution: until a revoke began recording
 * `granted = false`, taking a key away DELETED the row, so for every older key
 * "the organizer removed this" and "this workspace was never offered it" are
 * the same absence. Restricted to the keys no workspace can ever have been
 * offered, a reconcile can only fill a gap; widened to the whole defaults it
 * would hand an Admin back the `finRefund` somebody deliberately took away.
 *
 * Migration `0067` is this same list for the workspaces that exist today, and
 * `workspace-defaults.spec.ts` compares the two so they cannot drift apart.
 */
export function backfillableGrantsForSystemRole(
  name: string,
): readonly PermissionKey[] {
  return grantsForSystemRole(name).filter((key) =>
    KEYS_ADDED_AFTER_PROVISIONING.includes(key),
  );
}
