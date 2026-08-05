import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { organizations, payments, webhookEvents } from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import type { VerifiedWebhook } from './ports/payment-provider.port';

export type PaymentRow = typeof payments.$inferSelect;

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
