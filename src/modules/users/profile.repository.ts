import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { users } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { OutboxPort, type OutboxEventInput } from '../platform/outbox.port';
import type {
  PhoneChallengeInput,
  PhoneChallengeRow,
  ProfileRow,
} from './users.types';

const PROFILE_COLUMNS = {
  id: users.id,
  organizationId: users.organizationId,
  name: users.name,
  email: users.email,
  pendingEmail: users.pendingEmail,
  phone: users.phone,
  phoneVerifiedAt: users.phoneVerifiedAt,
  pendingPhone: users.pendingPhone,
  timezone: users.timezone,
  locale: users.locale,
  avatarUrl: users.avatarUrl,
  city: users.city,
  dateOfBirth: users.dateOfBirth,
  bio: users.bio,
  displayCurrency: users.displayCurrency,
};

/**
 * The code state behind a pending phone change. Selected on its own, never as
 * part of `PROFILE_COLUMNS` — the profile projection feeds a response DTO, and
 * a code hash has no business being one field away from the thing that is
 * serialised to the client.
 */
const PHONE_CHALLENGE_COLUMNS = {
  pendingPhone: users.pendingPhone,
  phoneCodeHash: users.phoneCodeHash,
  phoneCodeExpiresAt: users.phoneCodeExpiresAt,
  phoneCodeAttempts: users.phoneCodeAttempts,
};

/** Clears every trace of a code in flight. */
const NO_PHONE_CHALLENGE = {
  pendingPhone: null,
  phoneCodeHash: null,
  phoneCodeExpiresAt: null,
  phoneCodeAttempts: 0,
} as const;

/** Data access for a member's own profile (US-SET-01, US-DISC-11). */
@Injectable()
export class ProfileRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxPort,
  ) {}

  async find(
    organizationId: number,
    userId: string,
  ): Promise<ProfileRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select(PROFILE_COLUMNS)
        .from(users)
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.id, userId),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  async update(
    organizationId: number,
    userId: string,
    values: Partial<ProfileRow>,
  ): Promise<ProfileRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(eq(users.organizationId, organizationId), eq(users.id, userId)),
        )
        .returning(PROFILE_COLUMNS);
      return row ?? null;
    });
  }

  /** Is this address already a console account here (excluding me)? */
  async emailTaken(
    organizationId: number,
    userId: string,
    email: string,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, organizationId),
            ne(users.id, userId),
            isNull(users.deletedAt),
            or(eq(users.email, email), eq(users.pendingEmail, email)),
          ),
        )
        .limit(1);
      return row !== undefined;
    });
  }

  /** Promote the confirmed address and clear the pending one, atomically. */
  async promoteEmail(
    organizationId: number,
    userId: string,
    email: string,
  ): Promise<ProfileRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ email, pendingEmail: null, updatedAt: new Date() })
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.id, userId),
            eq(users.pendingEmail, email),
          ),
        )
        .returning(PROFILE_COLUMNS);
      return row ?? null;
    });
  }

  /**
   * Hold a requested number with the code that will prove it, and queue the
   * text in the SAME transaction (US-DISC-11 AC3).
   *
   * One transaction is the point: a row written without its event is a member
   * staring at "we texted you" for a code that was never sent, and an event
   * without its row is a code that nothing on this side will ever accept.
   * `phone` is untouched here — the old number keeps working.
   *
   * Replaces anything already in flight, including the attempt count: asking
   * again, for this number or a different one, is a fresh code and a fresh
   * five tries, and the previous code stops working the instant its hash is
   * overwritten.
   */
  async startPhoneChange(
    organizationId: number,
    userId: string,
    challenge: PhoneChallengeInput,
    event: OutboxEventInput,
  ): Promise<ProfileRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          pendingPhone: challenge.pendingPhone,
          phoneCodeHash: challenge.codeHash,
          phoneCodeExpiresAt: challenge.expiresAt,
          phoneCodeAttempts: 0,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.id, userId),
            isNull(users.deletedAt),
          ),
        )
        .returning(PROFILE_COLUMNS);
      if (!row) return null;
      await this.outbox.enqueueIn(tx, event);
      return row;
    });
  }

  /** The pending number and its code state — never returned past the service. */
  async findPhoneChallenge(
    organizationId: number,
    userId: string,
  ): Promise<PhoneChallengeRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select(PHONE_CHALLENGE_COLUMNS)
        .from(users)
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.id, userId),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * Count a wrong guess and, once `maxAttempts` is reached, destroy the code —
   * in ONE statement. Returns the number of wrong guesses now standing against
   * it.
   *
   * One statement because two would race: between a read-then-increment a
   * second request reads the same count, and the cap a six-digit code depends
   * on becomes advisory. The limit is passed in rather than read here because
   * it is a rule, and rules live in the service — the repository only has to
   * apply it in the same breath as the increment, which is the part that
   * cannot be done from outside SQL.
   */
  /**
   * Spend one guess and hand back the code to compare against, atomically.
   *
   * **Why this is one statement.** `confirm` used to SELECT the challenge, hash
   * the guess in memory, and only then increment — three steps with no row
   * lock, so every request that read before the first increment committed got
   * its guess compared. The cap bound nothing: 40 concurrent calls produced 39
   * counted failures, the limit of five never fired, and the correct fortieth
   * guess still promoted the number. The real bound was pool size times
   * replicas.
   *
   * Here the increment IS the claim. Concurrent statements serialize on the
   * row, and `phone_code_attempts < maxAttempts` means only the first
   * `maxAttempts` of them get a hash back — the rest see no row and have
   * nothing to compare.
   *
   * The hash is deliberately NOT nulled when the cap is reached, unlike
   * `recordPhoneCodeFailure`: leaving it costs nothing because the predicate
   * above already refuses, and nulling it in the same statement would return a
   * null hash to the very caller that just claimed the right to compare one.
   *
   * Null means there is nothing to guess against — no code in flight, or the
   * budget is spent. The caller says which, and deliberately says the same
   * thing for both.
   */
  async claimPhoneCodeAttempt(
    organizationId: number,
    userId: string,
    maxAttempts: number,
  ): Promise<{
    phoneCodeHash: string;
    phoneCodeExpiresAt: Date | null;
    pendingPhone: string | null;
  } | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          phoneCodeAttempts: sql`${users.phoneCodeAttempts} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.id, userId),
            isNull(users.deletedAt),
            isNotNull(users.phoneCodeHash),
            lt(users.phoneCodeAttempts, maxAttempts),
          ),
        )
        .returning({
          phoneCodeHash: users.phoneCodeHash,
          phoneCodeExpiresAt: users.phoneCodeExpiresAt,
          pendingPhone: users.pendingPhone,
        });
      if (!row?.phoneCodeHash) return null;
      return {
        phoneCodeHash: row.phoneCodeHash,
        phoneCodeExpiresAt: row.phoneCodeExpiresAt,
        pendingPhone: row.pendingPhone,
      };
    });
  }

  async recordPhoneCodeFailure(
    organizationId: number,
    userId: string,
    maxAttempts: number,
  ): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const spent = sql`${users.phoneCodeAttempts} + 1 >= ${maxAttempts}`;
      const [row] = await tx
        .update(users)
        .set({
          phoneCodeAttempts: sql`${users.phoneCodeAttempts} + 1`,
          phoneCodeHash: sql`case when ${spent} then null else ${users.phoneCodeHash} end`,
          phoneCodeExpiresAt: sql`case when ${spent} then null else ${users.phoneCodeExpiresAt} end`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.id, userId),
            isNull(users.deletedAt),
          ),
        )
        .returning({ attempts: users.phoneCodeAttempts });
      return row?.attempts ?? maxAttempts;
    });
  }

  /**
   * Promote the confirmed number and clear the challenge, atomically.
   *
   * Guarded on `pendingPhone` the way `promoteEmail` is guarded on
   * `pendingEmail`: if the member changed the number again between the code
   * being checked and this write, the update matches nothing and the caller
   * hears that the code is stale rather than promoting a number that is no
   * longer the one that was proven.
   */
  async promotePhone(
    organizationId: number,
    userId: string,
    phone: string,
  ): Promise<ProfileRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const now = new Date();
      const [row] = await tx
        .update(users)
        .set({
          phone,
          phoneVerifiedAt: now,
          ...NO_PHONE_CHALLENGE,
          updatedAt: now,
        })
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.id, userId),
            eq(users.pendingPhone, phone),
          ),
        )
        .returning(PROFILE_COLUMNS);
      return row ?? null;
    });
  }

  /** Remove the number and anything in flight (US-DISC-11). */
  async clearPhone(
    organizationId: number,
    userId: string,
  ): Promise<ProfileRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          phone: null,
          phoneVerifiedAt: null,
          ...NO_PHONE_CHALLENGE,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.id, userId),
            isNull(users.deletedAt),
          ),
        )
        .returning(PROFILE_COLUMNS);
      return row ?? null;
    });
  }
}
