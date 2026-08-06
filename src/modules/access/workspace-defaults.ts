import type { PermissionKey } from '../../common/decorators/require-permissions.decorator';

type PermGroup = 'Events' | 'Registrations' | 'Finance' | 'Settings';
type RoleName = 'Admin' | 'Organizer' | 'Staff';

/** The global permission catalog (permission_key enum → group + label). */
export const PERMISSION_CATALOG: {
  key: PermissionKey;
  group: PermGroup;
  label: string;
}[] = [
  { key: 'evCreate', group: 'Events', label: 'Create & edit events' },
  { key: 'evPublish', group: 'Events', label: 'Publish & unpublish events' },
  { key: 'evSpeakers', group: 'Events', label: 'Manage speakers & program' },
  { key: 'regView', group: 'Registrations', label: 'View registrations' },
  { key: 'regCheckin', group: 'Registrations', label: 'Check in attendees' },
  { key: 'regExport', group: 'Registrations', label: 'Export registrations' },
  { key: 'finView', group: 'Finance', label: 'View finances' },
  { key: 'finRefund', group: 'Finance', label: 'Issue refunds' },
  { key: 'finDiscount', group: 'Finance', label: 'Manage discounts' },
  {
    key: 'finManage',
    group: 'Finance',
    label: 'Void invoices, payouts & VAT filing',
  },
  { key: 'setUsers', group: 'Settings', label: 'Manage team' },
  { key: 'setSettings', group: 'Settings', label: 'Manage settings' },
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
      'finView',
      'finDiscount',
    ],
  },
  {
    name: 'Staff',
    description: 'Check-in & registration view',
    grants: ['regView', 'regCheckin'],
  },
];
