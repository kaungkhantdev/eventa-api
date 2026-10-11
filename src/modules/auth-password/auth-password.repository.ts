import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
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
import { OutboxPort, type OutboxEventInput } from '../platform/outbox.port';

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

/**
 * The signed-in account a change acts on (US-ACC-05). `name` and `email` are
 * here because the change has to announce itself, and the notice is addressed
 * to the account holder — read in the same breath as the hash that authorizes
 * the change, so the address can never be a later lookup that finds a different
 * row.
 */
export interface ChangeAccount {
  /** What the submitted current password is verified against. */
  passwordHash: string | null;
  name: string;
  email: string;
}

/** Data access for password reset (US-ACC-04) and change (US-ACC-05). */
@Injectable()
export class PasswordRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxPort,
  ) {}

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

  /**
   * The signed-in account a change acts on: the hash to verify against, and the
   * name and address the notice goes to (used by change-password).
   *
   * Scoped by both ids, as every other read here is, so a token minted for one
   * workspace can neither authorize nor address a change in another.
   */
  async findChangeAccount(
    organizationId: number,
    userId: string,
  ): Promise<ChangeAccount | null> {
    const [row] = await this.db
      .select({
        passwordHash: users.passwordHash,
        name: users.name,
        email: users.email,
      })
      .from(users)
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

  /**
   * Set a new password and sign out sessions. `keepSessionId` stays signed in
   * (change-password keeps the current device); omit it to revoke every session
   * (reset signs out everywhere).
   *
   * `buildNotice` queues the "your password was changed" mail in the SAME
   * transaction as the write, which is the whole point of it being a builder
   * rather than a finished event: the sentence about devices can only be
   * written once the revoke has said how many there were, and the row must
   * still live or die with the change. A notice enqueued after the commit is a
   * second write that can be lost, and the one it loses is the only signal a
   * stolen session gives its owner. Reset passes none — the link it already
   * sent is that flow's notice.
   */
  async setPassword(
    organizationId: number,
    userId: string,
    passwordHash: string,
    keepSessionId?: string,
    buildNotice?: (otherSessionsSignedOut: number) => OutboxEventInput,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(
          and(eq(users.id, userId), eq(users.organizationId, organizationId)),
        );
      // Scoped by organization_id as well as RLS, the house rule everywhere
      // else here — and now load-bearing rather than only hygiene, because the
      // rows this returns become a sentence in the member's email.
      const revoked = await tx
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(authSessions.userId, userId),
            eq(authSessions.organizationId, organizationId),
            isNull(authSessions.revokedAt),
            // Unexpired too, which is what the rest of this codebase means by a
            // live session — `AuthSessionsRepository.listLive` and
            // `AuthRepository.findValidSession` both pair these two.
            //
            // It was missing, and the omission reached the member. Nothing
            // purges a lapsed row and `createSession` inserts one per sign-in,
            // so somebody who signs in monthly for a year and never signs out
            // accumulates twelve rows with `revoked_at IS NULL, expires_at <
            // now()`. Changing their password from their only live device then
            // counted all twelve and told them twelve other devices had been
            // signed out — while their own Sessions page, which does check
            // expiry, showed none. The one number in a security notice, whose
            // whole job is to say how far an intruder already was, was inflated
            // by rows that could not authenticate anything.
            //
            // Revoking a lapsed row would change nothing — `findValidSession`
            // rejects it on expiry anyway — so narrowing the predicate costs no
            // security and makes the count mean what the sentence claims.
            gt(authSessions.expiresAt, new Date()),
            keepSessionId ? ne(authSessions.id, keepSessionId) : undefined,
          ),
        )
        .returning({ id: authSessions.id });
      if (buildNotice) {
        await this.outbox.enqueueIn(tx, buildNotice(revoked.length));
      }
    });
  }
}
