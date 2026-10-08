import { Injectable } from '@nestjs/common';
import type { PeriodChange } from '../../common/analytics/period-change';
import { Clock } from '../../common/time/clock';
import {
  DEFAULT_REPORT_LIMIT,
  type ReportFilterQueryDto,
} from './dto/report-filter.query.dto';
import {
  RegistrationReportPort,
  type RegistrationSplit,
  type RegistrationTotals,
} from './ports/registration-report.port';
import { changeBetween, LOWER_IS_BETTER } from './report-change';
import { resolveReportPeriod, type ReportPeriod } from './reports-period';

/**
 * Registrations by event and state (US-RPT-08).
 *
 * The first of the eight reports, and the shape the rest follow: resolve the
 * window here, hand it to the context that owns the data, and return the rows
 * with totals summed over the whole filter rather than the page.
 *
 * Nothing on this path touches an orders table — see `RegistrationReportPort`.
 */

/**
 * How each tile moved against the previous equal period.
 *
 * Every state except the last two is a sign-up arriving, so more of it reads as
 * better. A cancellation or a rejection is a registration LOST, and a falling
 * one is the improvement.
 */
export type RegistrationChanges = Record<
  keyof RegistrationTotals,
  PeriodChange
>;

export interface RegistrationsReportView {
  period: ReportPeriod;
  rows: RegistrationSplit[];
  /** How many events matched, so the caller can page them. */
  matchedEvents: number;
  totals: RegistrationTotals;
  changes: RegistrationChanges;
}

@Injectable()
export class RegistrationsReportService {
  constructor(
    private readonly registrations: RegistrationReportPort,
    private readonly clock: Clock,
  ) {}

  async load(
    organizationId: number,
    filter: ReportFilterQueryDto,
  ): Promise<RegistrationsReportView> {
    // Resolved before anything is fetched: a backwards window is a refusal, and
    // refusing after the query has run wastes the work and muddles the message.
    const period = resolveReportPeriod(filter, this.clock.now());

    const scope = { eventId: filter.eventId, search: filter.q };
    const [page, before] = await Promise.all([
      this.registrations.splitByEvent(organizationId, {
        from: period.from,
        to: period.to,
        ...scope,
        page: filter.page ?? 1,
        limit: filter.limit ?? DEFAULT_REPORT_LIMIT,
      }),
      // The same filter over the window before this one. Fetched whatever the
      // page, because the tiles describe the whole filter and must not change
      // as the reader pages through the rows beneath them.
      this.registrations.totalsFor(organizationId, {
        from: period.previousFrom,
        to: period.previousTo,
        ...scope,
      }),
    ]);

    return {
      period,
      rows: page.rows,
      matchedEvents: page.matchedEvents,
      totals: page.totals,
      changes: changesBetween(page.totals, before),
    };
  }
}

function changesBetween(
  now: RegistrationTotals,
  before: RegistrationTotals,
): RegistrationChanges {
  return {
    confirmed: changeBetween(now.confirmed, before.confirmed),
    pending: changeBetween(now.pending, before.pending),
    waitlisted: changeBetween(now.waitlisted, before.waitlisted),
    cancelled: changeBetween(now.cancelled, before.cancelled, LOWER_IS_BETTER),
    rejected: changeBetween(now.rejected, before.rejected, LOWER_IS_BETTER),
    total: changeBetween(now.total, before.total),
  };
}
