import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { auditEvents, payoutItems, payouts } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { PayoutFilters, PayoutRow, PayoutStatus } from './payouts.types';

const AUDIT_TYPE = 'payout' as const;

/** What one retry writes back (US-FIN-04). */
export interface RetryOutcome {
  status: 'processing' | 'failed';
  gatewayRef: string | null;
  failureReason: string | null;
  retriedBy: string;
  now: Date;
}

/**
 * Data access for payouts and their allocations. The `payout_items` unique on
 * `payment_id` alone is what makes the available balance trustworthy: a payment
 * can be allocated to at most one payout, so summing allocations can never
 * double-count money that has already gone out.
 */
@Injectable()
export class PayoutsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async page(
    organizationId: number,
    filters: PayoutFilters,
  ): Promise<{ items: PayoutRow[]; total: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.historyWhere(organizationId, filters);
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(payouts)
        .where(where);
      const rows = await tx
        .select(this.columns())
        .from(payouts)
        .where(where)
        .orderBy(desc(payouts.requestedAt), desc(payouts.id))
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit);
      return { items: rows.map(toRow), total: count };
    });
  }

  async findByReference(
    organizationId: number,
    reference: string,
  ): Promise<PayoutRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select(this.columns())
        .from(payouts)
        .where(
          and(
            eq(payouts.organizationId, organizationId),
            eq(payouts.reference, reference),
          ),
        )
        .limit(1);
      return row ? toRow(row) : null;
    });
  }

  /** Money already spoken for by a payout — what `available` subtracts. */
  async allocatedSatang(organizationId: number): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          total: sql<number>`coalesce(sum(${payoutItems.netSatang}), 0)::bigint`,
        })
        .from(payoutItems)
        .where(eq(payoutItems.organizationId, organizationId));
      return Number(row.total);
    });
  }

  /**
   * `pending` is money on its way (scheduled or processing); `paid` is what has
   * landed. Failed payouts count as neither — that money is still available.
   */
  async totalsByStatus(
    organizationId: number,
  ): Promise<{ pending: number; paid: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          pending: sql<string>`coalesce(sum(${payouts.amountSatang}) FILTER (
            WHERE ${payouts.status} IN ('scheduled', 'processing')), 0)::bigint`,
          paid: sql<string>`coalesce(sum(${payouts.amountSatang}) FILTER (
            WHERE ${payouts.status} = 'paid'), 0)::bigint`,
        })
        .from(payouts)
        .where(eq(payouts.organizationId, organizationId));
      return { pending: Number(row.pending), paid: Number(row.paid) };
    });
  }

  /**
   * Update the EXISTING payout — never insert a second one — and record the
   * retry for audit in the same transaction, so a recovery attempt can always
   * be traced to the Admin who made it.
   */
  async markRetried(
    organizationId: number,
    reference: string,
    outcome: RetryOutcome,
  ): Promise<PayoutRow> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(payouts)
        .set({
          status: outcome.status,
          gatewayRef: outcome.gatewayRef,
          failureReason: outcome.failureReason,
          requestedAt: outcome.now,
        })
        .where(
          and(
            eq(payouts.organizationId, organizationId),
            eq(payouts.reference, reference),
          ),
        )
        .returning(this.columns());
      await tx.insert(auditEvents).values({
        organizationId,
        type: AUDIT_TYPE,
        title: `Retried payout ${reference}`,
        actorUserId: outcome.retriedBy,
        meta: outcome.failureReason,
      });
      return toRow(row);
    });
  }

  private columns() {
    return {
      id: payouts.id,
      organizationId: payouts.organizationId,
      reference: payouts.reference,
      amountSatang: payouts.amountSatang,
      currency: payouts.currency,
      bankAccount: payouts.bankAccount,
      status: payouts.status,
      periodCovered: payouts.periodCovered,
      requestedAt: payouts.requestedAt,
      completedAt: payouts.completedAt,
      failureReason: payouts.failureReason,
    };
  }

  private historyWhere(
    organizationId: number,
    filters: PayoutFilters,
  ): SQL | undefined {
    const clauses = [eq(payouts.organizationId, organizationId)];
    if (filters.status) clauses.push(eq(payouts.status, filters.status));
    return and(...clauses);
  }
}

function toRow(row: Record<string, unknown>): PayoutRow {
  return {
    id: Number(row.id),
    organizationId: Number(row.organizationId),
    reference: row.reference as string,
    amountSatang: Number(row.amountSatang),
    currency: row.currency as string,
    bankAccount: row.bankAccount as string,
    status: row.status as PayoutStatus,
    periodCovered: (row.periodCovered as string | null) ?? null,
    requestedAt: row.requestedAt as Date,
    completedAt: (row.completedAt as Date | null) ?? null,
    failureReason: (row.failureReason as string | null) ?? null,
  };
}
