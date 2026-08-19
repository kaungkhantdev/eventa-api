import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  events,
  organizations,
  payments,
  refunds,
  webhookEvents,
} from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import type { VerifiedWebhook } from './ports/payment-provider.port';

export type PaymentRow = typeof payments.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;

/** Tax periods and invoice dates are the organizer's calendar day, not UTC's. */
const BANGKOK = 'Asia/Bangkok';

/** Everything one refund attempt writes (US-FIN-02). */
export interface ClaimRefundInput {
  organizationId: number;
  paymentId: string;
  orderId: string;
  amountSatang: number;
  currency: string;
  issuedBy: string;
  idempotencyKey: string;
  now: Date;
}

/** How the finance ledger is narrowed (US-FIN-01). */
export interface LedgerFilters {
  page: number;
  limit: number;
  status?: PaymentRow['status'];
  method?: string;
  eventId?: string;
  search?: string;
}

export interface LedgerRow {
  id: string;
  txn: string;
  payerName: string;
  eventName: string;
  method: string;
  amountSatang: number;
  currency: string;
  status: PaymentRow['status'];
  paidAt: Date | null;
  createdAt: Date;
}

export interface StatusCounts {
  paid: number;
  pending: number;
  refunded: number;
  failed: number;
}

/** Flip the ledger inside the caller's settlement transaction. */
export interface MarkRefundedInput {
  refundId: string;
  paymentId: string;
  gatewayRef: string;
  now: Date;
}

/** Everything one payment attempt writes. Money is the order's, never the caller's. */
export interface RecordAttemptInput {
  organizationId: number;
  orderId: string;
  eventId: string;
  payerName: string;
  method: string;
  amountSatang: number;
  currency: string;
  gatewayRef: string;
  statementDescriptor: string | null;
  idempotencyKey: string;
  status: 'pending' | 'failed';
  now: Date;
}

/**
 * Data access for payment attempts and the inbound webhook log. The `payments`
 * table is an append-only ledger: an attempt is inserted once per idempotency
 * key (`uq_payments_org_idem` makes a replay find its own row) and only ever
 * moves forward — pending → paid or failed, never back.
 */
@Injectable()
export class PaymentsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * How and when an order's money landed (US-FIN-07) — the newest paid attempt,
   * because a buyer who abandoned PromptPay and then paid by card has two rows
   * and the invoice must name the one that actually settled. The date is the
   * Bangkok calendar day, since that is the day the invoice prints.
   */
  async findSettlementForOrder(
    organizationId: number,
    orderId: string,
  ): Promise<{ method: string; paidOn: string } | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          method: payments.method,
          paidOn: sql<string>`to_char(${payments.paidAt} AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.orderId, orderId),
            eq(payments.status, 'paid'),
          ),
        )
        .orderBy(desc(payments.paidAt))
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * What the workspace actually collected each month of `year` (US-FIN-11),
   * VAT-inclusive and net of refunds — grouped by the Bangkok month the MONEY
   * MOVED in, not the month of the sale. A June ticket refunded in July belongs
   * to July's return, because June's has already gone to the Revenue
   * Department.
   */
  async takingsByMonth(
    organizationId: number,
    year: number,
  ): Promise<{ year: number; month: number; grossSatang: number }[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const result = await tx.execute<{ month: number; gross: string }>(sql`
        SELECT month, sum(gross)::bigint AS gross FROM (
          SELECT date_part('month', paid_at AT TIME ZONE ${BANGKOK})::int AS month,
                 amount_satang AS gross
            FROM payments
           WHERE organization_id = ${organizationId}
             AND status IN ('paid', 'refunded')
             AND paid_at IS NOT NULL
             AND date_part('year', paid_at AT TIME ZONE ${BANGKOK})::int = ${year}
          UNION ALL
          SELECT date_part('month', issued_at AT TIME ZONE ${BANGKOK})::int AS month,
                 -amount_satang AS gross
            FROM refunds
           WHERE organization_id = ${organizationId}
             AND status = 'succeeded'
             AND date_part('year', issued_at AT TIME ZONE ${BANGKOK})::int = ${year}
        ) movements
        GROUP BY month
      `);
      return result.rows.map((row) => ({
        year,
        month: Number(row.month),
        grossSatang: Number(row.gross),
      }));
    });
  }

  /**
   * Everything ever collected, net of refunds (US-FIN-03) — the ceiling on what
   * can be paid out. Both halves are summed in one statement so a refund
   * landing between two queries cannot make the balance briefly overstate.
   */
  async lifetimeNetTakings(organizationId: number): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const result = await tx.execute<{ net: string }>(sql`
        SELECT coalesce(sum(gross), 0)::bigint AS net FROM (
          SELECT amount_satang AS gross FROM payments
           WHERE organization_id = ${organizationId}
             AND status IN ('paid', 'refunded')
          UNION ALL
          SELECT -amount_satang AS gross FROM refunds
           WHERE organization_id = ${organizationId}
             AND status = 'succeeded'
        ) movements
      `);
      return Number(result.rows[0]?.net ?? 0);
    });
  }

  /** What the buyer's card statement shows (US-SET-10); from the workspace row. */
  async orgStatementDescriptor(organizationId: number): Promise<string | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ statementDescriptor: organizations.statementDescriptor })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return row?.statementDescriptor ?? null;
    });
  }

  /**
   * Record one attempt, idempotently: replaying the key returns the row the
   * first request created, so a double-submitted Pay never writes two ledger
   * lines — the provider side is deduplicated by the same key.
   */
  async upsertAttempt(input: RecordAttemptInput): Promise<PaymentRow> {
    return withTenant(this.db, input.organizationId, async (tx) => {
      const [inserted] = await tx
        .insert(payments)
        .values({
          organizationId: input.organizationId,
          txn: input.gatewayRef,
          orderId: input.orderId,
          eventId: input.eventId,
          payerName: input.payerName,
          method: input.method as PaymentRow['method'],
          amountSatang: input.amountSatang,
          currency: input.currency,
          status: input.status,
          gatewayRef: input.gatewayRef,
          statementDescriptor: input.statementDescriptor,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) return inserted;
      const [existing] = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.organizationId, input.organizationId),
            eq(payments.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      return existing;
    });
  }

  /**
   * The payment a provider callback refers to. Deliberately a GLOBAL lookup — a
   * webhook carries no tenant; the gateway reference it names is what resolves
   * one, exactly as an order id does for an anonymous buyer.
   */
  async findByGatewayRef(gatewayRef: string): Promise<PaymentRow | null> {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.gatewayRef, gatewayRef))
      .limit(1);
    return row ?? null;
  }

  /**
   * Flip a payment to paid INSIDE the settlement transaction the caller opened,
   * so the ledger line and the tickets it paid for commit together or not at all.
   */
  async markPaidIn(tx: Tx, paymentId: string, paidAt: Date): Promise<void> {
    await tx
      .update(payments)
      .set({ status: 'paid', paidAt, updatedAt: paidAt })
      .where(eq(payments.id, paymentId));
  }

  async markFailed(paymentId: string): Promise<void> {
    await this.db
      .update(payments)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'pending')));
  }

  /**
   * Claim an inbound callback for processing; false only when it has already
   * been processed to completion. `uq_webhook_events_provider_event` is what
   * makes processing exactly-once — two replicas racing the same event agree
   * here, in the database, not in code.
   *
   * The row is claimed, not merely recorded: a first attempt that died midway
   * (a deadlock while settling, a pod restart) leaves the row at `received`,
   * and the provider's retry MUST be allowed to finish the job. Short-circuiting
   * on mere existence would turn every retry into a silent no-op — money
   * captured, order never settled.
   */
  async recordWebhook(
    provider: string,
    verified: VerifiedWebhook,
  ): Promise<boolean> {
    const [inserted] = await this.db
      .insert(webhookEvents)
      .values({
        provider,
        providerEventId: verified.eventId,
        eventType: verified.type,
        payload: {
          gatewayRef: verified.gatewayRef,
          amountSatang: verified.amountSatang,
          declineReason: verified.declineReason,
        },
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (inserted) return true;
    const [existing] = await this.db
      .select({ status: webhookEvents.status })
      .from(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, provider),
          eq(webhookEvents.providerEventId, verified.eventId),
        ),
      )
      .limit(1);
    return existing?.status !== 'processed';
  }

  /** True when a DIFFERENT payment already settled this order (double charge). */
  async otherPaidPaymentExists(
    orderId: string,
    exceptPaymentId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.orderId, orderId),
          eq(payments.status, 'paid'),
          ne(payments.id, exceptPaymentId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Repoint a payment at the intent the buyer was actually handed. */
  async updateGatewayRef(paymentId: string, gatewayRef: string): Promise<void> {
    await this.db
      .update(payments)
      .set({ gatewayRef })
      .where(eq(payments.id, paymentId));
  }

  /** The payment an admin may refund — tenant-scoped, so another org's is invisible. */
  async findPaymentForRefund(
    organizationId: number,
    paymentId: string,
  ): Promise<PaymentRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.id, paymentId),
            eq(payments.organizationId, organizationId),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * Reserve the right to refund. `uq_refunds_org_idem` is what makes this the
   * decision point: the second caller loses the insert and gets the existing
   * row back with `fresh: false`, so only one request ever reaches the provider.
   */
  async claimRefund(
    input: ClaimRefundInput,
  ): Promise<{ refund: RefundRow; fresh: boolean }> {
    return withTenant(this.db, input.organizationId, async (tx) => {
      const [inserted] = await tx
        .insert(refunds)
        .values({
          organizationId: input.organizationId,
          paymentId: input.paymentId,
          orderId: input.orderId,
          amountSatang: input.amountSatang,
          currency: input.currency,
          status: 'pending',
          issuedBy: input.issuedBy,
          issuedAt: input.now,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) return { refund: inserted, fresh: true };
      const [existing] = await tx
        .select()
        .from(refunds)
        .where(
          and(
            eq(refunds.organizationId, input.organizationId),
            eq(refunds.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      return { refund: existing, fresh: false };
    });
  }

  /** The money did not move — record why, and leave the ticket valid. */
  async markRefundFailed(
    refundId: string,
    reason: string | null,
  ): Promise<void> {
    await this.db
      .update(refunds)
      .set({ status: 'failed', reason, updatedAt: new Date() })
      .where(eq(refunds.id, refundId));
  }

  /**
   * Flip refund AND payment inside the transaction that voids the tickets, so
   * a refunded payment and a freed seat commit together or not at all.
   */
  async markRefundedIn(tx: Tx, input: MarkRefundedInput): Promise<void> {
    await tx
      .update(refunds)
      .set({
        status: 'succeeded',
        gatewayRef: input.gatewayRef,
        updatedAt: input.now,
      })
      .where(eq(refunds.id, input.refundId));
    await tx
      .update(payments)
      .set({ status: 'refunded', updatedAt: input.now })
      .where(eq(payments.id, input.paymentId));
  }

  /** One page of the ledger, newest first (US-FIN-01). */
  async listLedger(
    organizationId: number,
    filters: LedgerFilters,
  ): Promise<{ items: LedgerRow[]; total: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = ledgerWhere(organizationId, filters);
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .innerJoin(events, eq(events.id, payments.eventId))
        .where(where);
      const items = await tx
        .select({
          id: payments.id,
          txn: payments.txn,
          payerName: payments.payerName,
          eventName: events.name,
          method: payments.method,
          amountSatang: payments.amountSatang,
          currency: payments.currency,
          status: payments.status,
          paidAt: payments.paidAt,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .innerJoin(events, eq(events.id, payments.eventId))
        .where(where)
        // Newest first; `created_at` breaks the tie for rows never paid.
        .orderBy(desc(payments.paidAt), desc(payments.createdAt))
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit);
      return { items, total: count };
    });
  }

  /**
   * Live totals for the status tabs. One scan with FILTER clauses rather than
   * four queries, so the four numbers describe the same instant — separate
   * counts could disagree with each other while a webhook lands between them.
   */
  async countByStatus(
    organizationId: number,
    filters: Omit<LedgerFilters, 'status'>,
  ): Promise<StatusCounts> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          paid: sql<number>`count(*) FILTER (WHERE ${payments.status} = 'paid')::int`,
          pending: sql<number>`count(*) FILTER (WHERE ${payments.status} = 'pending')::int`,
          refunded: sql<number>`count(*) FILTER (WHERE ${payments.status} = 'refunded')::int`,
          failed: sql<number>`count(*) FILTER (WHERE ${payments.status} = 'failed')::int`,
        })
        .from(payments)
        .innerJoin(events, eq(events.id, payments.eventId))
        .where(ledgerWhere(organizationId, filters));
      return row;
    });
  }

  /** Stamp the outcome, and attach the tenant once it is known. */
  async markWebhookProcessed(
    providerEventId: string,
    organizationId: number | null,
    status: 'processed' | 'failed',
  ): Promise<void> {
    await this.db
      .update(webhookEvents)
      .set({ status, processedAt: new Date(), organizationId })
      .where(eq(webhookEvents.providerEventId, providerEventId));
  }
}

/** Shared by the page and the counts, so the tabs describe what is listed. */
function ledgerWhere(
  organizationId: number,
  filters: Omit<LedgerFilters, 'status'> & { status?: PaymentRow['status'] },
) {
  const search = filters.search?.trim();
  return and(
    eq(payments.organizationId, organizationId),
    filters.status ? eq(payments.status, filters.status) : undefined,
    filters.method
      ? eq(payments.method, filters.method as PaymentRow['method'])
      : undefined,
    filters.eventId ? eq(payments.eventId, filters.eventId) : undefined,
    search
      ? or(
          ilike(payments.payerName, `%${search}%`),
          ilike(payments.txn, `%${search}%`),
        )
      : undefined,
  );
}
