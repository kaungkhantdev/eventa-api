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
