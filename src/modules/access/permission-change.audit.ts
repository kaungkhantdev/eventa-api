import type { Actor } from './access.types';
import { PERMISSION_CATALOG } from './workspace-defaults';
import {
  PERM_AUDIT_TYPE,
  SENSITIVE_FLAG,
  SENSITIVE_PERMISSIONS,
} from '../../common/constants/access.constants';

/**
 * How a change to who-can-do-what is written to the audit trail (US-SET-05,
 * US-SET-12, NFR-SUP-02): a member moved to another role, a role's grants
 * edited, a role created.
 *
 * Every such entry is `type = 'perm'`. The who is the row's actor, the when its
 * `occurred_at`, the from-where its IP; what this file decides is the words —
 * a title naming what changed, and a `meta` line with the detail.
 */

/** The words of one entry. */
export interface PermAuditText {
  title: string;
  meta: string | null;
}

/** A permission-change audit row, written in the same transaction as the change. */
export interface PermAuditRecord extends PermAuditText {
  type: typeof PERM_AUDIT_TYPE;
  actorUserId: string;
  ipAddress: string | null;
}

/** A role as far as an entry needs it: what it is called and what it grants. */
export interface RoleGrants {
  name: string;
  permissions: readonly string[];
}

/** A member moved from one role to another. */
export function memberRoleChangeAudit(
  member: string,
  from: RoleGrants,
  to: RoleGrants,
): PermAuditText {
  const gained = sensitive(without(to.permissions, from.permissions));
  return {
    title: flagged(
      `Changed ${member}'s role from ${from.name} to ${to.name}`,
      gained,
    ),
    meta:
      gained.length > 0 ? `Sensitive: ${gained.map(label).join(', ')}` : null,
  };
}

/** A role's grants edited; `null` when the save changed none of them. */
export function rolePermissionsAudit(
  role: string,
  before: readonly string[],
  after: readonly string[],
): PermAuditText | null {
  const granted = without(after, before);
  const revoked = without(before, after);
  if (granted.length === 0 && revoked.length === 0) return null;
  return {
    title: flagged(
      `Changed the permissions of the ${role} role`,
      sensitive(granted),
    ),
    meta: detail(granted, revoked),
  };
}

/** A role created with the grants it starts with. */
export function roleCreatedAudit(
  role: string,
  granted: readonly string[],
): PermAuditText {
  return {
    title: flagged(`Created the ${role} role`, sensitive(granted)),
    meta: detail(granted, []),
  };
}

/** The row to write: the words, plus who acted and from where. */
export function permAuditRecord(
  text: PermAuditText,
  actor: Actor,
): PermAuditRecord {
  return {
    type: PERM_AUDIT_TYPE,
    ...text,
    actorUserId: actor.userId,
    ipAddress: actor.ip,
  };
}

function detail(
  granted: readonly string[],
  revoked: readonly string[],
): string | null {
  const parts = [
    granted.length > 0 ? `Granted: ${granted.map(grantLabel).join(', ')}` : '',
    revoked.length > 0 ? `Revoked: ${revoked.map(label).join(', ')}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function flagged(title: string, sensitiveGrants: readonly string[]): string {
  return sensitiveGrants.length > 0 ? `${title}${SENSITIVE_FLAG}` : title;
}

function without(keys: readonly string[], minus: readonly string[]): string[] {
  return keys.filter((key) => !minus.includes(key));
}

function sensitive(keys: readonly string[]): string[] {
  return keys.filter((key) => SENSITIVE_PERMISSIONS.includes(key));
}

/** A granted key as the roles editor names it, marked when it is sensitive. */
function grantLabel(key: string): string {
  return SENSITIVE_PERMISSIONS.includes(key)
    ? `${label(key)} (sensitive)`
    : label(key);
}

/** The roles editor's wording for a key; the key itself if it has none. */
function label(key: string): string {
  return PERMISSION_CATALOG.find((p) => p.key === key)?.label ?? key;
}
