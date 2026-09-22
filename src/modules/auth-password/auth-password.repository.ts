import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  authSessions,
  organizations,
  socialIdentities,
  users,
  type memberStatusEnum,
  type socialProviderEnum,
} from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { Persona } from '../auth/auth.types';

export type AccountStatus = (typeof memberStatusEnum.enumValues)[number];
export type LinkedProvider = (typeof socialProviderEnum.enumValues)[number];

/** One account an address holds in the audience being reset (US-ACC-04). */
export interface ResetAccount {
  id: string;
  organizationId: number;
  /** The workspace it belongs to, so a reset email can say which one it opens. */
  workspaceName: string;
  name: string;
  status: AccountStatus;
  passwordHash: string | null;
  /** The social sign-ins linked to it — what an account with no password uses. */
  providers: LinkedProvider[];
}

/** The account a reset link was signed for, as it stands now (US-ACC-04). */
export interface ResetLinkAccount {
  id: string;
  organizationId: number;
  /** Which sign-in the account belongs to, so the page can send them there. */
  persona: Persona;
  /** Its organization's name — the workspace, for an organizer. */
  workspaceName: string;
  /** Whose fingerprint the link must still carry to be good. */
  passwordHash: string | null;
}

/** Data access for password reset (US-ACC-04) and change (US-ACC-05). */
@Injectable()
export class PasswordRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Every account an address holds in one audience, across workspaces
   * (pre-auth; used by forgot-password).
   *
   * All of them, not the first: an address can be an owner in one workspace and
   * an invitee in another, and which row came back first used to decide whether
   * the owner got a link at all. A deleted workspace is left out, as sign-in
   * leaves it out — a link into one would end at a door that never opens.
   * Oldest first, so the emails go out in a stable order.
   */
  async findResetAccounts(
    email: string,
    persona: Persona,
    limit: number,
  ): Promise<ResetAccount[]> {
    const rows = await this.db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        workspaceName: organizations.name,
        name: users.name,
        status: users.status,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(
        and(
          eq(users.email, email),
          eq(users.persona, persona),
          isNull(users.deletedAt),
          isNull(organizations.deletedAt),
        ),
      )
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(limit);
    const linked = await this.linkedProviders(rows.map((row) => row.id));
    return rows.map((row) => ({ ...row, providers: linked.get(row.id) ?? [] }));
  }

  /** The social providers linked to each account, keyed by user id. */
  private async linkedProviders(
    userIds: string[],
  ): Promise<Map<string, LinkedProvider[]>> {
    const byUser = new Map<string, LinkedProvider[]>();
    if (userIds.length === 0) return byUser;
    const links = await this.db
      .select({
        userId: socialIdentities.userId,
        provider: socialIdentities.provider,
      })
      .from(socialIdentities)
      .where(inArray(socialIdentities.userId, userIds));
    for (const { userId, provider } of links) {
      byUser.set(userId, [...(byUser.get(userId) ?? []), provider]);
    }
    return byUser;
  }

  /**
   * The account a reset link names, in the workspace the link names (pre-auth;
   * used by reset and by checking a link). Scoped by both ids, as
   * `currentHash` is, so a link signed for one workspace never reads another.
   */
  async findResetLinkAccount(
    organizationId: number,
    userId: string,
  ): Promise<ResetLinkAccount | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        persona: users.persona,
        workspaceName: organizations.name,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(
        and(
          eq(users.id, userId),
          eq(users.organizationId, organizationId),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** The current password hash for a signed-in user (used by change-password). */
  async currentHash(
    organizationId: number,
    userId: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.organizationId, organizationId),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    return row?.passwordHash ?? null;
  }

  /**
   * Set a new password and sign out sessions. `keepSessionId` stays signed in
   * (change-password keeps the current device); omit it to revoke every session
   * (reset signs out everywhere).
   */
  async setPassword(
    organizationId: number,
    userId: string,
    passwordHash: string,
    keepSessionId?: string,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.userId, userId),
            isNull(authSessions.revokedAt),
            keepSessionId ? ne(authSessions.id, keepSessionId) : undefined,
          ),
        );
    });
  }
}
