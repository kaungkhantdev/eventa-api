import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, desc, eq, ilike, like, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { auditEvents, events, invoices, orders } from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import { organizations } from '../../db/schema';
import {
  INVOICE_NUMBER_PREFIX,
  INVOICE_SEQUENCE_WIDTH,
  type InvoiceCounts,
  type InvoiceDocumentRow,
  type InvoiceFilters,
  type InvoiceRow,
  type InvoiceStatus,
} from './invoices.types';

/** Everything issuing one invoice writes (US-FIN-07). */
export interface IssueInvoiceInput {
  organizationId: number;
  orderId: string;
  eventId: string;
  buyerName: string;
  buyerEmail: string;
  issuedAt: string;
  dueAt: string;
  subtotalSatang: number;
  vatAmountSatang: number;
  amountSatang: number;
  currency: string;
  status: InvoiceStatus;
  paidVia: string | null;
  paidOn: string | null;
  actorUserId: string;
}

export interface VoidInvoiceInput {
  voidedBy: string;
  voidReason: string | null;
  now: Date;
}

const AUDIT_TYPE = 'invoice' as const;
const DEFAULT_VAT_RATE = 0.07;

/**
 * Data access for tax invoices. Two things here are load-bearing:
 *
 * - **Numbering is gap-free.** A Postgres sequence would leave holes whenever a
 *   transaction rolled back, and Thai tax rules do not tolerate a missing
 *   invoice number. So the next number is `MAX + 1` taken under a
 *   transaction-scoped advisory lock keyed on workspace + year — concurrent
 *   issuers queue rather than collide, and a rollback returns the number.
 * - **Overdue is derived, not stored.** `effectiveStatus` ages an unpaid
 *   invoice against today's Bangkok date in the same expression the filters and
 *   the tab counts use, so the list, the counts and the row can never disagree.
 */
@Injectable()
export class InvoicesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async issue(
    input: IssueInvoiceInput,
  ): Promise<{ invoice: InvoiceRow; fresh: boolean }> {
    return withTenant(this.db, input.organizationId, async (tx) => {
      const year = Number(input.issuedAt.slice(0, 4));
      await this.lockSequence(tx, input.organizationId, year);
      const existing = await this.findLiveForOrder(
        tx,
        input.organizationId,
        input.orderId,
      );
      if (existing) return { invoice: existing, fresh: false };
      const number = await this.nextNumber(tx, input.organizationId, year);
      const [row] = await tx
        .insert(invoices)
        .values({
          organizationId: input.organizationId,
          number,
          orderId: input.orderId,
          eventId: input.eventId,
          buyerName: input.buyerName,
          buyerEmail: input.buyerEmail,
          issuedAt: input.issuedAt,
          dueAt: input.dueAt,
          subtotalSatang: input.subtotalSatang,
          vatAmountSatang: input.vatAmountSatang,
          amountSatang: input.amountSatang,
          currency: input.currency,
          status: input.status,
          paidVia: input.paidVia as typeof invoices.$inferInsert.paidVia,
          paidOn: input.paidOn,
        })
        .returning({ id: invoices.id });
      await this.audit(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        title: `Issued invoice ${number}`,
      });
      const invoice = await this.findByIdIn(tx, input.organizationId, row.id);
      return { invoice: invoice as InvoiceRow, fresh: true };
    });
  }

  async findById(
    organizationId: number,
    invoiceId: number,
  ): Promise<InvoiceRow | null> {
    return withTenant(this.db, organizationId, (tx) =>
      this.findByIdIn(tx, organizationId, invoiceId),
    );
  }

  async markVoid(
    organizationId: number,
    invoiceId: number,
    input: VoidInvoiceInput,
  ): Promise<InvoiceRow> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(invoices)
        .set({
          status: 'void',
          voidedAt: input.now,
          voidedBy: input.voidedBy,
          voidReason: input.voidReason,
        })
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            eq(invoices.id, invoiceId),
          ),
        )
        .returning({ number: invoices.number });
      await this.audit(tx, {
        organizationId,
        actorUserId: input.voidedBy,
        title: `Voided invoice ${row.number}`,
        meta: input.voidReason,
      });
      const invoice = await this.findByIdIn(tx, organizationId, invoiceId);
      return invoice as InvoiceRow;
    });
  }

  /** One page of the ledger, newest issued first (US-FIN-06). */
  async page(
    organizationId: number,
    filters: InvoiceFilters,
    today: string,
  ): Promise<{ items: InvoiceRow[]; total: number }> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.ledgerWhere(organizationId, filters, today);
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .innerJoin(orders, eq(orders.id, invoices.orderId))
        .innerJoin(events, eq(events.id, invoices.eventId))
        .where(where);
      const items = await tx
        .select(this.columns())
        .from(invoices)
        .innerJoin(orders, eq(orders.id, invoices.orderId))
        .innerJoin(events, eq(events.id, invoices.eventId))
        .where(where)
        .orderBy(desc(invoices.issuedAt), desc(invoices.id))
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit);
      return { items: items.map(toRow), total: count };
    });
  }

  /** Live totals for the ledger tabs — one scan, so the four agree. */
  async countByStatus(
    organizationId: number,
    filters: Omit<InvoiceFilters, 'status'>,
    today: string,
  ): Promise<InvoiceCounts> {
    return withTenant(this.db, organizationId, async (tx) => {
      const effective = this.effectiveStatus(today);
      const [row] = await tx
        .select({
          issued: sql<number>`count(*) FILTER (WHERE ${effective} = 'issued')::int`,
          paid: sql<number>`count(*) FILTER (WHERE ${effective} = 'paid')::int`,
          overdue: sql<number>`count(*) FILTER (WHERE ${effective} = 'overdue')::int`,
          void: sql<number>`count(*) FILTER (WHERE ${effective} = 'void')::int`,
        })
        .from(invoices)
        .innerJoin(orders, eq(orders.id, invoices.orderId))
        .innerJoin(events, eq(events.id, invoices.eventId))
        .where(this.ledgerWhere(organizationId, filters, today));
      return row;
    });
  }

  /** The invoice plus the seller identity the printed document carries. */
  async findDocument(
    organizationId: number,
    invoiceId: number,
  ): Promise<InvoiceDocumentRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          ...this.columns(),
          sellerName: organizations.name,
          sellerAddress: organizations.address,
          sellerTaxId: organizations.taxId,
          vatRate: organizations.vatRate,
        })
        .from(invoices)
        .innerJoin(orders, eq(orders.id, invoices.orderId))
        .innerJoin(events, eq(events.id, invoices.eventId))
        .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
        .where(
          and(
            eq(invoices.organizationId, organizationId),
            eq(invoices.id, invoiceId),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        ...toRow(row),
        sellerName: row.sellerName,
        sellerAddress: row.sellerAddress,
        sellerTaxId: row.sellerTaxId,
        vatRate: row.vatRate ? Number(row.vatRate) : DEFAULT_VAT_RATE,
      };
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private columns() {
    return {
      id: invoices.id,
      organizationId: invoices.organizationId,
      number: invoices.number,
      orderId: invoices.orderId,
      orderReference: orders.reference,
      eventId: invoices.eventId,
      eventName: events.name,
      buyerName: invoices.buyerName,
      buyerEmail: invoices.buyerEmail,
      issuedAt: invoices.issuedAt,
      dueAt: invoices.dueAt,
      subtotalSatang: invoices.subtotalSatang,
      vatAmountSatang: invoices.vatAmountSatang,
      amountSatang: invoices.amountSatang,
      currency: invoices.currency,
      status: invoices.status,
      paidVia: invoices.paidVia,
      paidOn: invoices.paidOn,
      voidReason: invoices.voidReason,
    };
  }

  /**
   * How the row reads today: `paid` and `void` are terminal, anything else
   * whose due date has passed is `overdue`. Filters and counts share this
   * expression so a tab count can never contradict the list under it.
   */
  private effectiveStatus(today: string): SQL<InvoiceStatus> {
    return sql<InvoiceStatus>`CASE
      WHEN ${invoices.status} IN ('paid', 'void') THEN ${invoices.status}
      WHEN ${invoices.dueAt} < ${today}::date THEN 'overdue'
      ELSE 'issued'
    END`;
  }

  private ledgerWhere(
    organizationId: number,
    filters: Omit<InvoiceFilters, 'status'> & { status?: InvoiceStatus },
    today: string,
  ): SQL | undefined {
    const clauses: (SQL | undefined)[] = [
      eq(invoices.organizationId, organizationId),
    ];
    if (filters.status) {
      clauses.push(sql`${this.effectiveStatus(today)} = ${filters.status}`);
    }
    if (filters.eventId) clauses.push(eq(invoices.eventId, filters.eventId));
    if (filters.search) {
      const term = `%${filters.search}%`;
      clauses.push(
        or(ilike(invoices.number, term), ilike(invoices.buyerName, term)),
      );
    }
    return and(...clauses);
  }

  /**
   * Serialize numbering per workspace-year. Transaction-scoped, so it releases
   * on commit or rollback without any unlock call to forget.
   */
  private async lockSequence(
    tx: Tx,
    organizationId: number,
    year: number,
  ): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`invoice:${organizationId}:${year}`})::bigint)`,
    );
  }

  /**
   * `INV-<year>-<n+1>` for this workspace. The sequence number is read with
   * `split_part` rather than `substring(… from <offset>)`: an offset passed as a
   * bound parameter makes Postgres pick the *regular-expression* overload of
   * `substring`, which quietly returns NULL and would restart every invoice at
   * 0001.
   */
  private async nextNumber(
    tx: Tx,
    organizationId: number,
    year: number,
  ): Promise<string> {
    const prefix = `${INVOICE_NUMBER_PREFIX}-${year}-`;
    const [row] = await tx
      .select({
        last: sql<number>`coalesce(max(split_part(${invoices.number}, '-', 3)::int), 0)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          like(invoices.number, `${prefix}%`),
        ),
      );
    const next = Number(row.last) + 1;
    return `${prefix}${String(next).padStart(INVOICE_SEQUENCE_WIDTH, '0')}`;
  }

  private async findLiveForOrder(
    tx: Tx,
    organizationId: number,
    orderId: string,
  ): Promise<InvoiceRow | null> {
    const [row] = await tx
      .select(this.columns())
      .from(invoices)
      .innerJoin(orders, eq(orders.id, invoices.orderId))
      .innerJoin(events, eq(events.id, invoices.eventId))
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.orderId, orderId),
          sql`${invoices.status} <> 'void'`,
        ),
      )
      .limit(1);
    return row ? toRow(row) : null;
  }

  private async findByIdIn(
    tx: Tx,
    organizationId: number,
    invoiceId: number,
  ): Promise<InvoiceRow | null> {
    const [row] = await tx
      .select(this.columns())
      .from(invoices)
      .innerJoin(orders, eq(orders.id, invoices.orderId))
      .innerJoin(events, eq(events.id, invoices.eventId))
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.id, invoiceId),
        ),
      )
      .limit(1);
    return row ? toRow(row) : null;
  }

  /** The audit row commits with the change it describes, never after it. */
  private async audit(
    tx: Tx,
    input: {
      organizationId: number;
      actorUserId: string;
      title: string;
      meta?: string | null;
    },
  ): Promise<void> {
    await tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      type: AUDIT_TYPE,
      title: input.title,
      actorUserId: input.actorUserId,
      meta: input.meta ?? null,
    });
  }
}

/** Drizzle returns `bigint` money as a number and `date` as a string already. */
function toRow(row: Record<string, unknown>): InvoiceRow {
  return {
    id: Number(row.id),
    organizationId: Number(row.organizationId),
    number: row.number as string,
    orderId: row.orderId as string,
    orderReference: row.orderReference as string,
    eventId: row.eventId as string,
    eventName: row.eventName as string,
    buyerName: row.buyerName as string,
    buyerEmail: row.buyerEmail as string,
    issuedAt: row.issuedAt as string,
    dueAt: row.dueAt as string,
    subtotalSatang: Number(row.subtotalSatang),
    vatAmountSatang: Number(row.vatAmountSatang),
    amountSatang: Number(row.amountSatang),
    currency: row.currency as string,
    status: row.status as InvoiceStatus,
    paidVia: (row.paidVia as string | null) ?? null,
    paidOn: (row.paidOn as string | null) ?? null,
    voidReason: (row.voidReason as string | null) ?? null,
  };
}
