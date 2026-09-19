import { BANGKOK_OFFSET_MS, DAY_MS } from '../../common/time/bangkok';
import type { AttendanceReportDto } from './dto/attendance-report.dto';
import type { DiscountsReportDto } from './dto/discounts-report.dto';
import type { TransactionsReportDto } from './dto/transactions-report.dto';
import type { EventsReportDto } from './dto/events-report.dto';
import type { IncomeReportDto } from './dto/income-report.dto';
import type { OverviewReportDto } from './dto/overview-report.dto';
import type { RegistrationsReportDto } from './dto/registrations-report.dto';
import type { ReportPeriodDto } from './dto/report-common.dto';
import type { AttendanceReportView } from './attendance-report.service';
import type { DiscountsReportView } from './discounts-report.service';
import type { TransactionsReportView } from './transactions-report.service';
import type { EventsReportView } from './events-report.service';
import type { IncomeReportView } from './income-report.service';
import type { OverviewReportView } from './overview-report.service';
import type { RegistrationsReportView } from './registrations-report.service';
import type { ReportPeriod } from './reports-period';

/** Domain view → the wire shape. */

export function toRegistrationsReport(
  view: RegistrationsReportView,
): RegistrationsReportDto {
  return {
    period: toPeriod(view.period),
    rows: view.rows.map((row) => ({
      eventId: row.eventId,
      eventName: row.eventName,
      startAt: row.startAt.toISOString(),
      confirmed: row.confirmed,
      pending: row.pending,
      waitlisted: row.waitlisted,
      cancelled: row.cancelled,
      rejected: row.rejected,
      total: row.total,
    })),
    matchedEvents: view.matchedEvents,
    totals: view.totals,
    changes: view.changes,
  };
}

export function toAttendanceReport(
  view: AttendanceReportView,
): AttendanceReportDto {
  return {
    period: toPeriod(view.period),
    rows: view.rows.map((row) => ({
      eventId: row.eventId,
      eventName: row.eventName,
      startAt: row.startAt.toISOString(),
      registered: row.registered,
      checkedIn: row.checkedIn,
      noShows: row.noShows,
      attendanceRate: row.attendanceRate,
      onTimeRate: row.onTimeRate,
    })),
    matchedEvents: view.matchedEvents,
    totals: view.totals,
    changes: view.changes,
  };
}

export function toTransactionsReport(
  view: TransactionsReportView,
): TransactionsReportDto {
  return {
    period: toPeriod(view.period),
    rows: view.rows.map((row) => ({ ...row, at: row.at.toISOString() })),
    matchedEntries: view.matchedEntries,
    totals: view.totals,
  };
}

export function toDiscountsReport(
  view: DiscountsReportView,
): DiscountsReportDto {
  return {
    period: toPeriod(view.period),
    rows: view.rows,
    matchedCodes: view.matchedCodes,
    totals: view.totals,
  };
}

export function toEventsReport(view: EventsReportView): EventsReportDto {
  return {
    period: toPeriod(view.period),
    rows: view.rows.map((row) => ({
      eventId: row.eventId,
      eventName: row.eventName,
      startAt: row.startAt.toISOString(),
      venue: row.venue,
      city: row.city,
      lifecycle: row.lifecycle,
      registrations: row.registrations,
      revenueSatang: row.revenueSatang,
      attendanceRate: row.attendanceRate,
    })),
    matchedEvents: view.matchedEvents,
  };
}

export function toOverviewReport(view: OverviewReportView): OverviewReportDto {
  return {
    period: toPeriod(view.period),
    kpis: view.kpis,
    revenue: view.revenue,
  };
}

export function toIncomeReport(view: IncomeReportView): IncomeReportDto {
  return {
    period: toPeriod(view.period),
    rows: view.rows.map((row) => ({
      eventId: row.eventId,
      eventName: row.eventName,
      startAt: row.startAt.toISOString(),
      grossSatang: row.grossSatang,
      vatSatang: row.vatSatang,
      refundsSatang: row.refundsSatang,
      feesSatang: row.feesSatang,
      netSatang: row.netSatang,
      settledSatang: row.settledSatang,
    })),
    matchedEvents: view.matchedEvents,
    totals: view.totals,
    changes: view.changes,
  };
}

/**
 * The window, as the two calendar days a reader would name it by.
 *
 * `to` is exclusive inside the domain — the midnight that opens the day AFTER
 * the last one covered — so it is stepped back a day here. Reporting the raw
 * exclusive end would tell somebody who asked for "to 19 July" that they got
 * data to the 20th.
 */
function toPeriod(period: ReportPeriod): ReportPeriodDto {
  return {
    from: bangkokDayOf(period.from),
    to: bangkokDayOf(new Date(period.to.getTime() - DAY_MS)),
    days: period.days,
    trimmed: period.trimmed,
  };
}

/** The Bangkok calendar day an instant falls on, as `YYYY-MM-DD`. */
function bangkokDayOf(instant: Date): string {
  return new Date(instant.getTime() + BANGKOK_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}
