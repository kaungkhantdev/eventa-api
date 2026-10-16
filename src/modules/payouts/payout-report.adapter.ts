import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { withTenant } from '../../db/tenant';
import {
  PayoutReportPort,
  type PayoutCoveredEvent,
  type PayoutReportPage,
  type PayoutReportQuery,
  type PayoutReportRow,
  type ReportPayoutStatus,
} from '../reports/ports/payout-report.port';
import { maskAccount } from './payout-timeline';

/**
 * Payouts' implementation of the payouts report (US-RPT-07).
 *
 * "The events a payout covers" is not a column. A payout settles a set of
 * payments (`payout_items`), and each payment belongs to one event, so the
 * events are gathered per payout through its items — and the event filter is an
 * EXISTS over that same set. A payout covering three events therefore matches a
 * filter on any one of them, appears once, and still lists all three.
 * `payouts.event_id` is not used: nothing writes it, and one column cannot hold
 * a payout that covers several events.
 *
 * It reads `payments` and `events` as well as its own tables, in SQL, the way
 * the other report adapters do (Discounts joins orders and events, the ledger
 * joins events): read-only, and along the relation itself.
 *
 * Statuses are translated into the report's three here, by an explicit list in
 * both directions — a status the story has no word for (`failed`, or one added
 * to the enum later) is left out rather than labelled as something it is not.
 *
 * One literal statement, like the transaction ledger, for the same reason: a
 * CTE shared by the page and the totals keeps the tiles describing exactly the
 * rows beneath them. Values bind as parameters.
 */
@Injectable()
export class PayoutReportAdapter extends PayoutReportPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async payouts(
    organizationId: number,
    query: PayoutReportQuery,
  ): Promise<PayoutReportPage> {
    return withTenant(this.db, organizationId, async (tx) => {
      const matched = this.matched(organizationId, query);

      const rows = await tx.execute<PayoutRow>(sql`
        ${matched}
        SELECT * FROM matched
        ORDER BY at DESC, reference DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `);

      const summary = await tx.execute<SummaryRow>(sql`
        ${matched}
        SELECT
          count(*)::int AS payouts,
          coalesce(sum(amount_satang) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_out_satang,
          coalesce(sum(amount_satang) FILTER (WHERE status = 'in_transit'), 0)::bigint AS in_transit_satang,
          coalesce(sum(amount_satang) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_satang
        FROM matched
      `);

      const totals = summary.rows[0];
      const payouts = Number(totals?.payouts ?? 0);
      return {
        rows: rows.rows.map(toRow),
        matchedPayouts: payouts,
        totals: {
          payouts,
          paidOutSatang: Number(totals?.paid_out_satang ?? 0),
          inTransitSatang: Number(totals?.in_transit_satang ?? 0),
          pendingSatang: Number(totals?.pending_satang ?? 0),
        },
      };
    });
  }

  /**
   * The matching payouts, as a CTE the page and the totals share.
   *
   * A payout is dated when it landed, or when it was requested if it has not
   * yet — the transaction ledger's convention for money in flight.
   */
  private matched(organizationId: number, query: PayoutReportQuery) {
    const from = query.from.toISOString();
    const to = query.to.toISOString();
    const event = query.eventId ?? null;
    const search = query.search ? `%${query.search}%` : null;

    return sql`
      WITH covered AS (
        SELECT DISTINCT pi.payout_id, e.id AS event_id, e.name AS event_name
        FROM payout_items pi
        JOIN payments p ON p.id = pi.payment_id
        JOIN events e ON e.id = p.event_id
        WHERE pi.organization_id = ${organizationId}
      ),
      matched AS (
        SELECT
          po.reference                               AS reference,
          coalesce(po.completed_at, po.requested_at) AS at,
          po.bank_account                            AS bank_account,
          po.amount_satang                           AS amount_satang,
          CASE po.status
            WHEN 'paid' THEN 'paid'
            WHEN 'processing' THEN 'in_transit'
            WHEN 'scheduled' THEN 'pending'
          END                                        AS status,
          coalesce((
            SELECT json_agg(
              json_build_object('eventId', c.event_id, 'eventName', c.event_name)
              ORDER BY c.event_name, c.event_id
            )
            FROM covered c
            WHERE c.payout_id = po.id
          ), '[]'::json)                             AS events
        FROM payouts po
        WHERE po.organization_id = ${organizationId}
          AND po.status IN ('paid', 'processing', 'scheduled')
          AND coalesce(po.completed_at, po.requested_at) >= ${from}::timestamptz
          AND coalesce(po.completed_at, po.requested_at) <  ${to}::timestamptz
          AND (${event}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM covered c
            WHERE c.payout_id = po.id AND c.event_id = ${event}::uuid
          ))
          -- Not the bank account: it is free text that may hold a full number,
          -- and matching on it would let a search confirm digits the screen is
          -- not allowed to show (US-RPT-07).
          AND (${search}::text IS NULL OR po.reference ILIKE ${search} OR EXISTS (
            SELECT 1 FROM covered c
            WHERE c.payout_id = po.id AND c.event_name ILIKE ${search}
          ))
      )
    `;
  }
}

interface PayoutRow extends Record<string, unknown> {
  reference: string;
  at: Date;
  bank_account: string;
  amount_satang: string;
  status: ReportPayoutStatus;
  events: PayoutCoveredEvent[];
}

interface SummaryRow extends Record<string, unknown> {
  payouts: number;
  paid_out_satang: string;
  in_transit_satang: string;
  pending_satang: string;
}

function toRow(row: PayoutRow): PayoutReportRow {
  return {
    reference: row.reference,
    at: new Date(row.at),
    // Masked here, by the module that owns the column, so no other module ever
    // holds the stored value.
    bankAccount: maskAccount(row.bank_account),
    events: row.events,
    amountSatang: Number(row.amount_satang),
    status: row.status,
  };
}
