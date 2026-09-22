import type { AttendanceReportView } from './attendance-report.service';
import type { DiscountsReportView } from './discounts-report.service';
import type { EventsReportView } from './events-report.service';
import type { IncomeReportView } from './income-report.service';
import type { RegistrationsReportView } from './registrations-report.service';
import type { TransactionsReportView } from './transactions-report.service';
import {
  attendanceBody,
  discountsBody,
  eventsBody,
  incomeBody,
  registrationsBody,
  transactionsBody,
} from './report-tables';

/**
 * One typed table per report (US-RPT-11).
 *
 * The CSV, the workbook and the PDF all render from THIS, so the three formats
 * cannot disagree about what a report says. Which means the values here stay
 * in the domain's own units — integer satang, a Date, a null — and each
 * format decides for itself how to write them down.
 */

const PERIOD = {
  from: new Date('2026-07-01T00:00:00+07:00'),
  to: new Date('2026-08-01T00:00:00+07:00'),
  previousFrom: new Date('2026-06-01T00:00:00+07:00'),
  previousTo: new Date('2026-07-01T00:00:00+07:00'),
  days: 31,
  trimmed: false,
};

const START = new Date('2026-07-18T02:00:00.000Z');

describe('money in a report table', () => {
  it('keeps money as integer satang, not as a rendered price', () => {
    // A formatted string could not be summed, and each format would have to
    // parse it back to do anything with it.
    const view = {
      period: PERIOD,
      rows: [
        {
          eventId: 'e-1',
          eventName: 'Tech Summit 2026',
          startAt: START,
          grossSatang: 107_000,
          vatSatang: 7_000,
          refundsSatang: 10_000,
          feesSatang: 3_000,
          netSatang: 90_000,
          settledSatang: 87_000,
        },
      ],
      matchedEvents: 1,
      totals: {
        grossSatang: 107_000,
        vatSatang: 7_000,
        refundsSatang: 10_000,
        feesSatang: 3_000,
        netSatang: 90_000,
        settledSatang: 87_000,
      },
    } as unknown as IncomeReportView;

    const body = incomeBody(view);
    expect(body.table.rows[0]).toEqual([
      'Tech Summit 2026',
      START,
      107_000,
      7_000,
      10_000,
      3_000,
      90_000,
      87_000,
    ]);
    expect(body.table.columns.map((column) => column.kind)).toEqual([
      'text',
      'day',
      'money',
      'money',
      'money',
      'money',
      'money',
      'money',
    ]);
  });

  it('leaves money the reader may not see as null, never as zero', () => {
    // "You may not see this" and "it earned nothing" are different facts.
    const view = {
      period: PERIOD,
      rows: [
        {
          eventId: 'e-1',
          eventName: 'Staff View',
          startAt: START,
          venue: null,
          city: null,
          lifecycle: 'completed',
          registrations: 4,
          revenueSatang: null,
          attendanceRate: 80,
        },
      ],
      matchedEvents: 1,
    } as unknown as EventsReportView;

    const [row] = eventsBody(view).table.rows;
    expect(row[6]).toBeNull();
    expect(row[6]).not.toBe(0);
  });

  it('signs a refund in the table, so every format agrees on its direction', () => {
    const view = {
      period: PERIOD,
      rows: [
        {
          id: 'refund:r-1',
          kind: 'refund',
          reference: 'TXN-8842-R1',
          at: new Date('2026-07-18T09:00:00.000Z'),
          personName: 'Ploy Srisai',
          eventId: 'e-1',
          eventName: 'Tech Summit 2026',
          method: 'Card',
          amountSatang: 125_000,
          outcome: 'succeeded',
          paymentId: 'p-1',
        },
      ],
      matchedEntries: 1,
      totals: {
        entries: 1,
        payments: 0,
        failed: 0,
        refunds: 1,
        collectedSatang: 0,
        refundedSatang: 125_000,
        successRate: null,
      },
    } as unknown as TransactionsReportView;

    const [row] = transactionsBody(view).table.rows;
    expect(row[6]).toBe(-125_000);
    // The ledger's instant survives as a Date: the workbook needs a date cell,
    // not a string it would have to parse back.
    expect(row[1]).toEqual(new Date('2026-07-18T09:00:00.000Z'));
  });
});

describe('figures that do not exist', () => {
  it('leaves an unstarted event’s rates null rather than zero', () => {
    const view = {
      period: PERIOD,
      rows: [
        {
          eventId: 'e-1',
          eventName: 'Still To Come',
          startAt: START,
          registered: 40,
          checkedIn: 0,
          onTime: 0,
          started: false,
          noShows: null,
          attendanceRate: null,
          onTimeRate: null,
        },
      ],
      matchedEvents: 1,
      totals: {
        checkedIn: 0,
        noShows: null,
        attendanceRate: null,
        onTimeRate: null,
      },
    } as unknown as AttendanceReportView;

    const body = attendanceBody(view);
    expect(body.table.rows[0].slice(2)).toEqual([40, 0, null, null, null]);
    // And the tiles say the same: a rate nobody can compute is not 0%.
    expect(body.summary.map((figure) => figure.value)).toEqual([
      0,
      null,
      null,
      null,
    ]);
  });
});

describe('the key figures a file carries', () => {
  it('mirrors the registrations tiles, in the order the screen shows them', () => {
    const view = {
      period: PERIOD,
      rows: [],
      matchedEvents: 3,
      totals: {
        confirmed: 80,
        pending: 12,
        waitlisted: 4,
        cancelled: 6,
        rejected: 2,
        total: 104,
      },
    } as unknown as RegistrationsReportView;

    expect(registrationsBody(view).summary).toEqual([
      { label: 'Total registrations', kind: 'count', value: 104 },
      { label: 'Confirmed', kind: 'count', value: 80 },
      { label: 'Pending', kind: 'count', value: 12 },
      { label: 'Cancelled', kind: 'count', value: 6 },
    ]);
  });

  it('reads the income tiles as money', () => {
    const view = {
      period: PERIOD,
      rows: [],
      matchedEvents: 1,
      totals: {
        grossSatang: 107_000,
        vatSatang: 7_000,
        refundsSatang: 10_000,
        feesSatang: 3_000,
        netSatang: 90_000,
        settledSatang: 87_000,
      },
    } as unknown as IncomeReportView;

    expect(incomeBody(view).summary).toEqual([
      { label: 'Gross revenue', kind: 'money', value: 107_000 },
      { label: 'Refunds', kind: 'money', value: 10_000 },
      { label: 'Processing fees', kind: 'money', value: 3_000 },
      { label: 'Net revenue', kind: 'money', value: 90_000 },
    ]);
  });

  it('reads the transactions tiles, with no success rate when nothing was attempted', () => {
    const view = {
      period: PERIOD,
      rows: [],
      matchedEntries: 0,
      totals: {
        entries: 0,
        payments: 0,
        failed: 0,
        refunds: 0,
        collectedSatang: 0,
        refundedSatang: 0,
        successRate: null,
      },
    } as unknown as TransactionsReportView;

    const body = transactionsBody(view);
    expect(body.summary).toEqual([
      { label: 'Transactions', kind: 'count', value: 0 },
      { label: 'Payments', kind: 'money', value: 0 },
      { label: 'Refunds', kind: 'count', value: 0 },
      { label: 'Success rate', kind: 'percent', value: null },
    ]);
  });

  it('reads the discounts tiles', () => {
    const view = {
      period: PERIOD,
      rows: [],
      matchedCodes: 2,
      totals: {
        activeCodes: 1,
        redemptions: 18,
        discountSatang: 36_000,
        influencedSatang: 250_000,
        returnRatio: null,
      },
    } as unknown as DiscountsReportView;

    expect(discountsBody(view).summary).toEqual([
      { label: 'Active codes', kind: 'count', value: 1 },
      { label: 'Redemptions', kind: 'count', value: 18 },
      { label: 'Discount given', kind: 'money', value: 36_000 },
      { label: 'Revenue influenced', kind: 'money', value: 250_000 },
    ]);
  });

  it('has only a count to show for event performance', () => {
    const view = {
      period: PERIOD,
      rows: [],
      matchedEvents: 7,
    } as unknown as EventsReportView;

    expect(eventsBody(view).summary).toEqual([
      { label: 'Events', kind: 'count', value: 7 },
    ]);
  });
});

describe('how many rows the filter matched', () => {
  it('counts events, codes or ledger entries, whichever the report is about', () => {
    const events = {
      period: PERIOD,
      rows: [],
      matchedEvents: 7,
    } as unknown as EventsReportView;
    const codes = {
      period: PERIOD,
      rows: [],
      matchedCodes: 4,
      totals: {
        activeCodes: 0,
        redemptions: 0,
        discountSatang: 0,
        influencedSatang: 0,
        returnRatio: null,
      },
    } as unknown as DiscountsReportView;
    const entries = {
      period: PERIOD,
      rows: [],
      matchedEntries: 900,
      totals: {
        entries: 900,
        payments: 900,
        failed: 0,
        refunds: 0,
        collectedSatang: 0,
        refundedSatang: 0,
        successRate: 100,
      },
    } as unknown as TransactionsReportView;

    expect(eventsBody(events).matched).toBe(7);
    expect(discountsBody(codes).matched).toBe(4);
    expect(transactionsBody(entries).matched).toBe(900);
  });
});

describe('the wording a discount code carries', () => {
  it('finishes a fixed code’s terms when the API left it in satang', () => {
    const view = {
      period: PERIOD,
      rows: [
        {
          discountId: 'd-1',
          code: 'FLAT200',
          standing: 'active',
          terms: null,
          fixedValueSatang: 20_000,
          scope: 'All events',
          redemptions: 3,
          discountSatang: 60_000,
          influencedSatang: 300_000,
          returnRatio: 5,
        },
      ],
      matchedCodes: 1,
      totals: {
        activeCodes: 1,
        redemptions: 3,
        discountSatang: 60_000,
        influencedSatang: 300_000,
        returnRatio: 5,
      },
    } as unknown as DiscountsReportView;

    expect(discountsBody(view).table.rows[0][1]).toBe('200.00 off');
  });
});
