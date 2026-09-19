import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { discountCodes, events } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import {
  DiscountReportPort,
  type DiscountPerformancePage,
  type DiscountPerformanceQuery,
  type DiscountStanding,
} from '../reports/ports/discount-report.port';

/**
 * Discounts' implementation of the payback report (US-RPT-10), so Reports never
 * reads the promotions tables.
 *
 * Driven FROM `discount_codes`, so a scheduled code that nobody has used yet
 * still gets a row reading zero — which the story asks for by name. Starting
 * from `discount_redemptions` would have hidden exactly the codes an organizer
 * most wants to check on.
 *
 * `revenue_attributed_satang` is deliberately NOT read. Its own comment calls it
 * a reporting rollup, but nothing in the product has ever written it — the only
 * writes in the codebase are two test fixtures setting it to 0 — so reading it
 * would print ฿0 for every code, with no error anywhere to say why.
 */

/**
 * Where a code stands, from the clock.
 *
 * `disabled` is switched off by hand and wins over the dates, the same way a
 * cancelled event beats the calendar. The other three are derived rather than
 * read from `status`, because that column is only settled as a side effect of
 * listing codes on another screen — a report must not depend on somebody having
 * visited one.
 */
const STANDING = sql<DiscountStanding>`CASE
  WHEN discount_codes.status = 'disabled' THEN 'disabled'
  WHEN discount_codes.valid_from IS NOT NULL AND now() < discount_codes.valid_from THEN 'scheduled'
  WHEN discount_codes.valid_until IS NOT NULL AND now() > discount_codes.valid_until THEN 'expired'
  ELSE 'active'
END`;

@Injectable()
export class DiscountReportAdapter extends DiscountReportPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async payback(
    organizationId: number,
    query: DiscountPerformanceQuery,
  ): Promise<DiscountPerformancePage> {
    return withTenant(this.db, organizationId, async (tx) => {
      const where = this.matching(organizationId, query);
      const figures = this.figures(query.eventId);

      const rows = await tx
        .select({
          discountId: discountCodes.id,
          code: discountCodes.code,
          kind: discountCodes.type,
          value: discountCodes.value,
          standing: STANDING,
          eventName: events.name,
          ...figures,
        })
        .from(discountCodes)
        .leftJoin(events, eq(events.id, discountCodes.eventId))
        .where(where)
        .orderBy(desc(figures.influencedSatang), desc(discountCodes.code))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      const [summary] = await tx
        .select({
          matched: sql<number>`count(*)::int`,
          activeCodes: sql<number>`count(*) FILTER (WHERE ${STANDING} = 'active')::int`,
          redemptions: sql<string>`coalesce(sum(${figures.redemptions}), 0)::bigint`,
          discountSatang: sql<string>`coalesce(sum(${figures.discountSatang}), 0)::bigint`,
          influencedSatang: sql<string>`coalesce(sum(${figures.influencedSatang}), 0)::bigint`,
        })
        .from(discountCodes)
        .leftJoin(events, eq(events.id, discountCodes.eventId))
        .where(where);

      return {
        rows: rows.map((row) => ({
          ...row,
          redemptions: Number(row.redemptions),
          discountSatang: Number(row.discountSatang),
          influencedSatang: Number(row.influencedSatang),
        })),
        matchedCodes: Number(summary?.matched ?? 0),
        totals: {
          activeCodes: Number(summary?.activeCodes ?? 0),
          redemptions: Number(summary?.redemptions ?? 0),
          discountSatang: Number(summary?.discountSatang ?? 0),
          influencedSatang: Number(summary?.influencedSatang ?? 0),
        },
      };
    });
  }

  /**
   * Which codes the window shows: any whose validity overlaps it.
   *
   * A code with no dates at all runs forever and always overlaps. The FIGURES
   * are not windowed — see below.
   */
  private matching(organizationId: number, query: DiscountPerformanceQuery) {
    return and(
      eq(discountCodes.organizationId, organizationId),
      isNull(discountCodes.deletedAt),
      or(
        isNull(discountCodes.validFrom),
        lte(discountCodes.validFrom, query.to),
      ),
      or(
        isNull(discountCodes.validUntil),
        sql`${discountCodes.validUntil} >= ${query.from.toISOString()}::timestamptz`,
      ),
      // A code scoped to every event is relevant to any one of them, so an
      // event filter keeps it — and narrows its figures to that event instead.
      query.eventId
        ? or(
            eq(discountCodes.eventId, query.eventId),
            isNull(discountCodes.eventId),
          )
        : undefined,
      query.search ? ilike(discountCodes.code, `%${query.search}%`) : undefined,
    );
  }

  /**
   * A code's payback, over its whole life rather than the report's window.
   *
   * A campaign that ran in March has a March payback; re-counting it inside a
   * 30-day window would report every finished promotion as having achieved
   * nothing. The window decides which codes are worth listing, not what they
   * achieved.
   *
   * All three figures count CONFIRMED orders only: a redemption on an
   * abandoned or cancelled checkout is not payback, and counting it would
   * credit the promotion with sales that never happened.
   *
   * Literal SQL with aliases, not `${discountRedemptions.orderId}` — Drizzle
   * strips the table qualifier off an interpolated column inside a select-list
   * subquery, which silently correlates the subquery to itself and returns a
   * confident zero. Values still interpolate safely; only columns are mangled.
   */
  private figures(eventId: string | undefined) {
    const scoped = sql`(${eventId ?? null}::uuid IS NULL OR o.event_id = ${eventId ?? null}::uuid)`;
    const redeemed = (select: string) => sql`(
      SELECT ${sql.raw(select)}
      FROM discount_redemptions r
      JOIN orders o ON o.id = r.order_id
      WHERE r.discount_code_id = discount_codes.id
        AND o.status = 'confirmed'
        AND o.deleted_at IS NULL
        AND ${scoped}
    )`;
    return {
      redemptions: sql<string>`coalesce(${redeemed('count(*)')}, 0)::bigint`,
      discountSatang: sql<string>`coalesce(${redeemed('sum(r.amount_satang)')}, 0)::bigint`,
      // The order's own total, after the discount came off — what the code
      // actually caused somebody to spend.
      influencedSatang: sql<string>`coalesce(${redeemed('sum(o.total_satang)')}, 0)::bigint`,
    };
  }
}
