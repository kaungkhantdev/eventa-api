import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  auditEvents,
  authSessions,
  memberships,
  organizations,
  rolePermissions,
  users,
} from '../../db/schema';
import type { OrganizationRow, UserRow } from './auth.types';

type Persona = 'admin' | 'attendee';
type AuditType =
  | 'signin'
  | 'newdev'
  | 'pwd'
  | 'twofa'
  | 'perm'
  | 'xport'
  | 'fail'
  | 'apikey'
  | 'revoke';

export interface CreateSessionInput {
  organizationId: number;
  userId: string;
  device: string;
  ip: string | null;
  expiresAt: Date;
}

export interface AuditInput {
  organizationId: number;
  type: AuditType;
  title: string;
  actorUserId: string | null;
  ip: string | null;
  meta?: string | null;
}

/**
 * Data access for the identity module. NOTE: the pre-auth lookups (findLoginUser,
 * findValidSession) run before a tenant is known; under a non-owner DB role they
 * must go through a SECURITY DEFINER path — see the RLS note in the 0002 migration.
 */
@Injectable()
export class IdentityRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findLoginUser(
    orgSlug: string,
    email: string,
    persona: Persona,
  ): Promise<{ user: UserRow; org: OrganizationRow } | null> {
    const rows = await this.db
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(
        and(
          eq(organizations.slug, orgSlug),
          eq(users.email, email),
          eq(users.persona, persona),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Refresh-session validity check (used on token refresh; null if revoked/expired). */
  async findValidSession(
    sessionId: string,
  ): Promise<{ userId: string; organizationId: number } | null> {
    const rows = await this.db
      .select({
        userId: authSessions.userId,
        organizationId: authSessions.organizationId,
      })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.id, sessionId),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Load a user + their organization (for /auth/me). */
  async findProfile(
    userId: string,
  ): Promise<{ user: UserRow; org: OrganizationRow } | null> {
    const rows = await this.db
      .select({ user: users, org: organizations })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createSession(input: CreateSessionInput): Promise<string> {
    const [row] = await this.db
      .insert(authSessions)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        device: input.device,
        ipAddress: input.ip,
        expiresAt: input.expiresAt,
        isCurrent: true,
      })
      .returning({ id: authSessions.id });
    return row.id;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)),
      );
  }

  /** An Invited membership (+ the user's email), or null once accepted/absent.
   *  Pre-auth lookup (the invitee isn't signed in) — not tenant-scoped. */
  async findInvitedMembership(
    membershipId: number,
  ): Promise<{ userId: string; organizationId: number; email: string } | null> {
    const rows = await this.db
      .select({
        userId: memberships.userId,
        organizationId: memberships.organizationId,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.id, membershipId),
          eq(memberships.status, 'Invited'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Set the invitee's password and flip both the user and membership to Active. */
  async activateInvite(
    userId: string,
    membershipId: number,
    passwordHash: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, status: 'Active' })
        .where(eq(users.id, userId));
      await tx
        .update(memberships)
        .set({ status: 'Active', joinedAt: new Date() })
        .where(eq(memberships.id, membershipId));
    });
  }

  async touchLastActive(userId: string): Promise<void> {
    await this.db
      .update(users)
      .set({ lastActiveAt: new Date() })
      .where(eq(users.id, userId));
  }

  async recordAudit(input: AuditInput): Promise<void> {
    await this.db.insert(auditEvents).values({
      organizationId: input.organizationId,
      type: input.type,
      title: input.title,
      actorUserId: input.actorUserId,
      ipAddress: input.ip,
      meta: input.meta ?? null,
    });
  }

  /** Permission keys granted to the user in this org (via their active membership's role). */
  async getPermissions(
    organizationId: number,
    userId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ key: rolePermissions.permissionKey })
      .from(memberships)
      .innerJoin(
        rolePermissions,
        eq(rolePermissions.roleId, memberships.roleId),
      )
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.status, 'Active'),
          eq(rolePermissions.granted, true),
        ),
      );
    return rows.map((r) => r.key);
  }
}
