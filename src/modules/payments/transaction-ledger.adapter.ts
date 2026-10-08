import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { withTenant } from '../../db/tenant';
import {
  TransactionLedgerPort,
  type LedgerEntry,
  type LedgerKind,
  type LedgerOutcome,
  type LedgerPage,
  type LedgerQuery,
} from '../reports/ports/transaction-ledger.port';

/**
 * Payments' implementation of the transaction ledger (US-RPT-06).
 *
 * A UNION of two legs, not a join. A charge and its reversal are separate
 * events at separate times, and the story requires both as their own rows —
 * "the refund appears as a new entry and the original payment is marked
 * Refunded; the original amount is never rewritten". A join would also
 * duplicate a payment once per refund raised against it.
 *
 * Written as one literal SQL statement rather than through the query builder:
 * the two legs have different shapes and a window function over one of them,
 * which Drizzle's builder expresses poorly — and interpolating columns into a
 * raw fragment is exactly where it silently drops table qualifiers. Values
 * still bind as parameters; only columns are mangled, and there are none here.
 */
@Injectable()
export class TransactionLedgerAdapter extends TransactionLedgerPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async ledger(
    organizationId: number,
    query: LedgerQuery,
  ): Promise<LedgerPage> {
    return withTenant(this.db, organizationId, async (tx) => {
      const entries = this.union(organizationId, query);

      const rows = await tx.execute<LedgerRow>(sql`
        ${entries}
        SELECT * FROM ledger
        ORDER BY at DESC, reference DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `);

      const summary = await tx.execute<SummaryRow>(sql`
        ${entries}
        SELECT
          count(*)::int AS entries,
          count(*) FILTER (WHERE kind = 'payment' AND outcome <> 'failed')::int AS payments,
          count(*) FILTER (WHERE kind = 'payment' AND outcome = 'failed')::int AS failed,
          count(*) FILTER (WHERE kind = 'refund')::int AS refunds,
          coalesce(sum(amount_satang) FILTER (
            WHERE kind = 'payment' AND outcome <> 'failed'), 0)::bigint AS collected_satang,
          coalesce(sum(amount_satang) FILTER (WHERE kind = 'refund'), 0)::bigint AS refunded_satang
        FROM ledger
      `);

      const totals = summary.rows[0];
      return {
        rows: rows.rows.map(toEntry),
        matchedEntries: Number(totals?.entries ?? 0),
        totals: {
          entries: Number(totals?.entries ?? 0),
          payments: Number(totals?.payments ?? 0),
          failed: Number(totals?.failed ?? 0),
          refunds: Number(totals?.refunds ?? 0),
          collectedSatang: Number(totals?.collected_satang ?? 0),
          refundedSatang: Number(totals?.refunded_satang ?? 0),
        },
      };
    });
  }

  /**
   * Both legs, as one CTE the page query and the totals query share — so the
   * tiles describe exactly the rows beneath them.
   *
   * A payment is stamped when it settled, or when it was attempted if it never
   * did; a refund when it was issued. A `pending` charge is deliberately in:
   * this is a ledger for investigating a specific transaction, and money stuck
   * in flight is the thing most worth finding.
   */
  private union(organizationId: number, query: LedgerQuery) {
    const from = query.from.toISOString();
    const to = query.to.toISOString();
    const event = query.eventId ?? null;
    const search = query.search ? `%${query.search}%` : null;

    return sql`
      WITH ledger AS (
        SELECT
          'payment:' || p.id      AS id,
          'payment'               AS kind,
          p.txn                   AS reference,
          coalesce(p.paid_at, p.created_at) AS at,
          p.payer_name            AS person_name,
          p.event_id              AS event_id,
          e.name                  AS event_name,
          p.method::text          AS method,
          p.amount_satang         AS amount_satang,
          CASE p.status
            WHEN 'paid' THEN 'succeeded'
            WHEN 'refunded' THEN 'refunded'
            WHEN 'pending' THEN 'pending'
            ELSE 'failed'
          END                     AS outcome,
          p.id                    AS payment_id
        FROM payments p
        JOIN events e ON e.id = p.event_id
        WHERE p.organization_id = ${organizationId}
          AND coalesce(p.paid_at, p.created_at) >= ${from}::timestamptz
          AND coalesce(p.paid_at, p.created_at) <  ${to}::timestamptz
          AND (${event}::uuid IS NULL OR p.event_id = ${event}::uuid)
          AND (${search}::text IS NULL OR p.payer_name ILIKE ${search} OR p.txn ILIKE ${search})

        UNION ALL

        SELECT
          'refund:' || r.id AS id,
          'refund'          AS kind,
          -- The refunds table carries no human reference, so one is derived
          -- from the parent's: TXN-8842-R1, -R2. Readable and stable for a
          -- given set of refunds; NOT an identifier anything stores.
          p.txn || '-R' || row_number() OVER (
            PARTITION BY r.payment_id ORDER BY r.issued_at, r.id
          )                 AS reference,
          r.issued_at       AS at,
          p.payer_name      AS person_name,
          p.event_id        AS event_id,
          e.name            AS event_name,
          p.method::text    AS method,
          r.amount_satang   AS amount_satang,
          r.status::text    AS outcome,
          p.id              AS payment_id
        FROM refunds r
        JOIN payments p ON p.id = r.payment_id
        JOIN events e ON e.id = p.event_id
        WHERE r.organization_id = ${organizationId}
          AND r.issued_at >= ${from}::timestamptz
          AND r.issued_at <  ${to}::timestamptz
          AND (${event}::uuid IS NULL OR p.event_id = ${event}::uuid)
          AND (${search}::text IS NULL OR p.payer_name ILIKE ${search} OR p.txn ILIKE ${search})
      )
    `;
  }
}

interface LedgerRow extends Record<string, unknown> {
  id: string;
  kind: LedgerKind;
  reference: string;
  at: Date;
  person_name: string;
  event_id: string;
  event_name: string;
  method: string;
  amount_satang: string;
  outcome: LedgerOutcome;
  payment_id: string;
}

interface SummaryRow extends Record<string, unknown> {
  entries: number;
  payments: number;
  failed: number;
  refunds: number;
  collected_satang: string;
  refunded_satang: string;
}

function toEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    kind: row.kind,
    reference: row.reference,
    at: new Date(row.at),
    personName: row.person_name,
    eventId: row.event_id,
    eventName: row.event_name,
    method: row.method,
    amountSatang: Number(row.amount_satang),
    outcome: row.outcome,
    paymentId: row.payment_id,
  };
}
