import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { authSessions, events, orders, users } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { OutboxEventInput } from '../platform/outbox.port';
import { OutboxPort } from '../platform/outbox.port';
import type {
  AccountRow,
  UpcomingPaidOrderRow,
} from './account-deletion.types';

/** Only a confirmed AND settled order is money the deleter forfeits. */
const CONFIRMED = 'confirmed';
const PAID = 'paid';

/**
 * Data access for account deletion (US-DISC-14). Writes stay inside the
 * identity family's tables (`users`, `auth_sessions`) — the same boundary
 * `auth-password` already owns for reset — and the warning read is a
 * person-scoped read model in the mould of `attendee-payments`.
 */
@Injectable()
export class AccountDeletionRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxPort,
  ) {}

  /** The live account behind the token — null once deleted. */
  async findAccount(
    organizationId: number,
    userId: string,
  ): Promise<AccountRow | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        persona: users.persona,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
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

  /** Upcoming events this email paid for — the non-refundable warning list. */
  async upcomingPaidOrders(email: string): Promise<UpcomingPaidOrderRow[]> {
    return this.db
      .select({
        reference: orders.reference,
        eventName: events.name,
        startAt: events.startAt,
        ticketCount: orders.seats,
        totalSatang: orders.totalSatang,
      })
      .from(orders)
      .innerJoin(events, eq(events.id, orders.eventId))
      .where(
        and(
          eq(orders.buyerEmail, email),
          eq(orders.status, CONFIRMED),
          eq(orders.paymentStatus, PAID),
          gt(orders.totalSatang, 0),
          sql`coalesce(${events.endAt}, ${events.startAt}) >= now()`,
          isNull(orders.deletedAt),
        ),
      )
      .orderBy(asc(events.startAt), asc(orders.id));
  }

  /**
   * The deletion itself — one transaction or nothing: stamp `deleted_at`
   * (every login/profile path filters on it), revoke EVERY session including
   * the current one, and enqueue the outbox event that triggers the
   * confirmation email + PDPA anonymization. Returns false when the account
   * was already gone, in which case nothing else is written.
   */
  async scheduleDeletion(
    organizationId: number,
    userId: string,
    event: OutboxEventInput,
  ): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const now = new Date();
      const deleted = await tx
        .update(users)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(users.id, userId),
            eq(users.organizationId, organizationId),
            isNull(users.deletedAt),
          ),
        )
        .returning({ id: users.id });
      if (deleted.length === 0) return false;
      await tx
        .update(authSessions)
        .set({ revokedAt: now })
        .where(
          and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)),
        );
      await this.outbox.enqueueIn(tx, event);
      return true;
    });
  }
}
