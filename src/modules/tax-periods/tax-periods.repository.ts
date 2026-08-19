import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { organizations, taxPeriods } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { FiledPeriod } from './tax-periods.types';
import { MONTHS_IN_YEAR, monthLabel, periodDueDate } from './vat-period';

/** The Thai statutory rate, if a workspace row somehow carries none. */
const DEFAULT_VAT_RATE = 0.07;

/**
 * Data access for filed VAT periods. Only FILED periods are stored — an open
 * period is computed from the payment ledger every time it is read, so there is
 * no accumulated figure to drift. Filing is therefore an insert, and the unique
 * `(organization_id, period, year)` is what stops the same return being filed
 * twice under a race.
 */
@Injectable()
export class TaxPeriodsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The workspace's VAT rate — the one its prices were charged at. */
  async vatRate(organizationId: number): Promise<number> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ vatRate: organizations.vatRate })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return row?.vatRate ? Number(row.vatRate) : DEFAULT_VAT_RATE;
    });
  }

  async filedPeriods(
    organizationId: number,
    year: number,
  ): Promise<FiledPeriod[]> {
    return withTenant(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          period: taxPeriods.period,
          salesSatang: taxPeriods.salesSatang,
          vatSatang: taxPeriods.vatSatang,
          whtSatang: taxPeriods.whtSatang,
          remittedSatang: taxPeriods.remittedSatang,
          filedAt: taxPeriods.filedAt,
        })
        .from(taxPeriods)
        .where(
          and(
            eq(taxPeriods.organizationId, organizationId),
            eq(taxPeriods.year, year),
            eq(taxPeriods.status, 'filed'),
          ),
        );
      return rows.flatMap((row) => {
        const month = monthOf(row.period);
        if (!month || !row.filedAt) return [];
        return [
          {
            year,
            month,
            salesSatang: Number(row.salesSatang),
            vatSatang: Number(row.vatSatang),
            whtSatang: Number(row.whtSatang),
            remittedSatang: Number(row.remittedSatang),
            filedAt: row.filedAt,
          },
        ];
      });
    });
  }

  /**
   * Freeze a period at what was filed. `onConflictDoNothing` on the natural key
   * makes a double-submitted filing a no-op rather than a second return — the
   * caller has already refused an already-filed period, this closes the race.
   */
  async recordFiling(
    organizationId: number,
    input: FiledPeriod,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .insert(taxPeriods)
        .values({
          organizationId,
          period: monthLabel(input.month),
          year: input.year,
          dueAt: periodDueDate(input.year, input.month),
          salesSatang: input.salesSatang,
          vatSatang: input.vatSatang,
          whtSatang: input.whtSatang,
          remittedSatang: input.remittedSatang,
          status: 'filed',
          filedAt: input.filedAt,
        })
        .onConflictDoNothing({
          target: [
            taxPeriods.organizationId,
            taxPeriods.period,
            taxPeriods.year,
          ],
        });
    });
  }
}

/** `Jun` → 6; anything unrecognised is skipped rather than guessed. */
function monthOf(label: string): number | null {
  for (let month = 1; month <= MONTHS_IN_YEAR; month += 1) {
    if (monthLabel(month) === label) return month;
  }
  return null;
}
