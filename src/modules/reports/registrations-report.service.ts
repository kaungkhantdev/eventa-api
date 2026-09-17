import { Injectable } from '@nestjs/common';
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

export interface RegistrationsReportView {
  period: ReportPeriod;
  rows: RegistrationSplit[];
  /** How many events matched, so the caller can page them. */
  matchedEvents: number;
  totals: RegistrationTotals;
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

    const page = await this.registrations.splitByEvent(organizationId, {
      from: period.from,
      to: period.to,
      eventId: filter.eventId,
      search: filter.q,
      page: filter.page ?? 1,
      limit: filter.limit ?? DEFAULT_REPORT_LIMIT,
    });

    return {
      period,
      rows: page.rows,
      matchedEvents: page.matchedEvents,
      totals: page.totals,
    };
  }
}
