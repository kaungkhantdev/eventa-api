import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import {
  events,
  invoices,
  orders,
  organizations,
  payments,
} from '../../db/schema';
import { stampedSeller } from '../../db/seller-identity';
import type {
  ReceiptRow,
  TransactionRow,
  TransactionStatus,
  TransactionSummary,
} from './attendee-payments.types';
import {
  DEFAULT_VAT_RATE,
  MAX_EXPORT,
} from '../../common/constants/attendee-payments.constants';

/** Only settled money is a transaction; attempts that never charged are not. */
const SETTLED: readonly TransactionStatus[] = ['paid', 'refunded'];

/**
 * The number of the invoice issued for the payment's order (US-DISC-10). At
 * most one is live (`uq_invoices_live_order`), and it wins; with none live — a
 * refunded sale's was voided — the last one issued still names the invoice
 * that sale was billed on. Null when the organizer never issued one.
 */
const invoiceNumber = sql<string | null>`(
  SELECT ${invoices.number} FROM ${invoices}
  WHERE ${invoices.orderId} = ${orders.id}
  ORDER BY ${invoices.status} = 'void', ${invoices.id} DESC
  LIMIT 1
)`;

/**
 * The attendee's payment-history read model (US-DISC-10), in the mould of
 * `AttendeeTicketsRepository`: cross-tenant on purpose — one person's spending
 * spans every workspace — and scoped by the PERSON, via the buyer email the
 * order was placed with. Read-only throughout.
 */
@Injectable()
export class AttendeePaymentsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async summaryByEmail(email: string): Promise<TransactionSummary> {
    const [row] = await this.db
      .select({
        totalSpentSatang: sql<number>`coalesce(sum(${payments.amountSatang})
          FILTER (WHERE ${payments.status} = 'paid'), 0)::bigint`,
        totalRefundedSatang: sql<number>`coalesce(sum(${payments.amountSatang})
          FILTER (WHERE ${payments.status} = 'refunded'), 0)::bigint`,
        transactionCount: sql<number>`count(*)::int`,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(this.mine(email));
    return {
      totalSpentSatang: Number(row.totalSpentSatang),
      totalRefundedSatang: Number(row.totalRefundedSatang),
      transactionCount: row.transactionCount,
    };
  }

  async transactionsByEmail(
    email: string,
    page: { limit: number; offset: number },
  ): Promise<{ items: TransactionRow[]; total: number }> {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(this.mine(email));
    const items = await this.transactionSelect()
      .where(this.mine(email))
      .orderBy(desc(payments.paidAt), desc(payments.id))
      .limit(page.limit)
      .offset(page.offset);
    return { items: items.map(normalise), total: count };
  }

  async allTransactionsByEmail(email: string): Promise<TransactionRow[]> {
    const rows = await this.transactionSelect()
      .where(this.mine(email))
      .orderBy(desc(payments.paidAt), desc(payments.id))
      .limit(MAX_EXPORT);
    return rows.map(normalise);
  }

  /**
   * One receipt — or null when it does not exist OR is not this email's. The
   * seller is the identity stamped when the payment settled (US-SET-07).
   */
  async receiptByIdForEmail(
    paymentId: string,
    email: string,
  ): Promise<ReceiptRow | null> {
    const seller = stampedSeller(payments);
    const [row] = await this.db
      .select({
        paymentId: payments.id,
        orderId: orders.id,
        reference: orders.reference,
        invoiceNumber,
        eventName: events.name,
        method: payments.method,
        status: payments.status,
        amountSatang: payments.amountSatang,
        vatSatang: orders.vatAmountSatang,
        paidAt: payments.paidAt,
        buyerName: orders.buyerName,
        buyerEmail: orders.buyerEmail,
        organizerName: seller.sellerName,
        organizerAddress: seller.sellerAddress,
        organizerTaxId: seller.sellerTaxId,
        vatRate: organizations.vatRate,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .innerJoin(events, eq(events.id, payments.eventId))
      .innerJoin(organizations, eq(organizations.id, payments.organizationId))
      .where(and(eq(payments.id, paymentId), this.mine(email)))
      .limit(1);
    if (!row) return null;
    return {
      ...normalise(row),
      buyerName: row.buyerName,
      buyerEmail: row.buyerEmail,
      organizerName: row.organizerName,
      organizerAddress: row.organizerAddress,
      organizerTaxId: row.organizerTaxId,
      vatRate: row.vatRate ? Number(row.vatRate) : DEFAULT_VAT_RATE,
    };
  }

  private transactionSelect() {
    return this.db
      .select({
        paymentId: payments.id,
        orderId: orders.id,
        reference: orders.reference,
        invoiceNumber,
        eventName: events.name,
        method: payments.method,
        status: payments.status,
        amountSatang: payments.amountSatang,
        vatSatang: orders.vatAmountSatang,
        paidAt: payments.paidAt,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .innerJoin(events, eq(events.id, payments.eventId))
      .$dynamic();
  }

  private mine(email: string) {
    return and(
      eq(orders.buyerEmail, email),
      inArray(payments.status, [...SETTLED]),
    );
  }
}

/** The settled filter guarantees the narrower status type. */
function normalise<
  T extends { status: string; amountSatang: number; vatSatang: number },
>(row: T): T & { status: TransactionStatus } {
  return {
    ...row,
    status: row.status as TransactionStatus,
    amountSatang: Number(row.amountSatang),
    vatSatang: Number(row.vatSatang),
  };
}
