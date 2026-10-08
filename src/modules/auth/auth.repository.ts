import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { auditEvents, authSessions, memberships, users } from '../../db/schema';
import { withTenant } from '../../db/tenant';

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
 * Data access for authentication: refresh sessions, the audit trail, and invite
 * acceptance. The user record itself lives in UsersRepository.
 */
@Injectable()
export class AuthRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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

  /**
   * `withTenant`, because `audit_events` is one of the RLS tables in migration
   * 0002 and its policy's WITH CHECK compares `organization_id` against the
   * `app.current_org` setting. Unset, `current_setting(...)` is NULL, the
   * comparison is NULL rather than true, and Postgres refuses the row.
   *
   * This wrote fine for a long time only because every developer and every test
   * connects as `eventa`, which owns the tables — and an owner bypasses RLS
   * while no migration sets FORCE ROW LEVEL SECURITY. Under the non-owning role
   * the app uses in staging and production, every sign-in lost its audit entry.
   */
  async recordAudit(input: AuditInput): Promise<void> {
    await withTenant(this.db, input.organizationId, async (tx) => {
      await tx.insert(auditEvents).values({
        organizationId: input.organizationId,
        type: input.type,
        title: input.title,
        actorUserId: input.actorUserId,
        ipAddress: input.ip,
        meta: input.meta ?? null,
      });
    });
  }
}
