import {
  memberStatusEnum,
  memberships,
  permissionKeyEnum,
  roles,
  users,
} from '../../db/schema/index';
import type { PermissionKey } from '../decorators/require-permissions.decorator';

/** The access module's named constants. */

export const ACTIVE_STATUS = 'Active' as const;

/** The role that must never be left without a holder. */
export const ADMIN_ROLE = 'Admin' as const;

export const MEMBER_COLUMNS = {
  id: memberships.id,
  userId: memberships.userId,
  name: users.name,
  email: users.email,
  roleId: memberships.roleId,
  role: roles.name,
  status: memberships.status,
};

export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 100;

export const KEYS = permissionKeyEnum.enumValues;

export const MAX_NAME = 40;

export const MAX_DESCRIPTION = 200;

export const STATUSES = memberStatusEnum.enumValues;

/** Long enough for any name or address; a bound, not a rule. */
export const MAX_SEARCH = 120;

/** Routing key for a teammate's join link (consumed by eventa-worker). */
export const IDENTITY_MEMBER_INVITED = 'identity.member_invited';

/** Every permission-change audit row is `type = 'perm'`. */
export const PERM_AUDIT_TYPE = 'perm' as const;

/**
 * Capabilities whose grant is "clearly flagged in the record" (US-SET-12).
 * Exactly the story's own examples: exporting attendee data and issuing
 * refunds.
 */
export const SENSITIVE_PERMISSIONS: readonly string[] = [
  'regExport',
  'finRefund',
] satisfies PermissionKey[];

/** Appended to a title when the change grants a sensitive capability. */
export const SENSITIVE_FLAG = ' — sensitive access granted';

/** Without this key nobody can administer the workspace's people. */
export const MANAGE_USERS: PermissionKey = 'setUsers';
