export interface PermissionCatalogItem {
  key: string;
  group: string;
  label: string;
}

export interface RoleWithPermissions {
  id: number;
  name: string;
  description: string;
  permissions: string[];
  /** Live members holding this role — the roles overview badge (US-SET-13). */
  memberCount: number;
  /** Built-in roles cannot be renamed away; custom ones are created by an Admin. */
  isSystem: boolean;
}

/** A team member = a membership joined with its user and role. */
export interface MemberRow {
  id: number; // membership id
  userId: string;
  name: string;
  email: string;
  roleId: number;
  role: string;
  status: string;
}

export interface ListMembersQuery {
  page?: number;
  limit?: number;
}

export interface ListMembersOptions {
  limit: number;
  offset: number;
}

/** Payload to invite a teammate (admin side). */
export interface InviteMemberInput {
  name: string;
  email: string;
  roleId: number;
}
