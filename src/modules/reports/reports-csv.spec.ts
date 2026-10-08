import type { AttendanceReportView } from './attendance-report.service';
import type { DiscountsReportView } from './discounts-report.service';
import type { EventsReportView } from './events-report.service';
import type { IncomeReportView } from './income-report.service';
import {
  attendanceCsv,
  discountsCsv,
  eventsCsv,
  incomeCsv,
  transactionsCsv,
} from './reports-csv';
import type { TransactionsReportView } from './transactions-report.service';

/**
 * A report as a file (US-RPT-11).
 *
 * Every rule here exists because a spreadsheet reads differently from a person:
 * a dash is a word it cannot add up, a zero is a claim, and ฿1,070 is text.
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

describe('money in a report file', () => {
  it('writes Baht with two decimals, as a number rather than a price', () => {
    // "฿1,070" is text to a spreadsheet; 1070.00 adds up.
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
    } as unknown as IncomeReportView;

    const [row] = incomeCsv(view).rows;
    expect(row).toContain('1070.00');
    expect(row).toContain('900.00');
  });

  it('leaves money the reader may not see as an empty cell', () => {
    // Not 0.00, which would assert the event earned nothing.
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

    expect(eventsCsv(view).rows[0]).toEqual([
      'Staff View',
      '2026-07-18',
      '',
      '',
      'completed',
      '4',
      '',
      '80',
    ]);
  });

  it('signs a refund, because a column of figures has no colour', () => {
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
    } as unknown as TransactionsReportView;

    expect(transactionsCsv(view).rows[0]).toContain('-1250.00');
  });
});

describe('figures that do not exist', () => {
  it('leaves an unstarted event’s attendance empty rather than zero', () => {
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
    } as unknown as AttendanceReportView;

    const [row] = attendanceCsv(view).rows;
    // Registered and checked-in are real counts; the three rates are not.
    expect(row.slice(2)).toEqual(['40', '0', '', '', '']);
  });

  it('leaves an unused code’s return empty', () => {
    const view = {
      period: PERIOD,
      rows: [
        {
          discountId: 'd-1',
          code: 'AUTUMN15',
          standing: 'scheduled',
          terms: '15% off',
          fixedValueSatang: null,
          scope: 'All events',
          redemptions: 0,
          discountSatang: 0,
          influencedSatang: 0,
          returnRatio: null,
        },
      ],
    } as unknown as DiscountsReportView;

    expect(discountsCsv(view).rows[0].at(-1)).toBe('');
  });
});

describe('dates', () => {
  it('writes a calendar day as ISO, in Bangkok', () => {
    // 02:00 UTC is 09:00 on the 18th in Bangkok — the day the organizer means.
    const view = {
      period: PERIOD,
      rows: [
        {
          eventId: 'e-1',
          eventName: 'Tech Summit 2026',
          startAt: START,
          confirmed: 1,
          pending: 0,
          waitlisted: 0,
          cancelled: 0,
          rejected: 0,
          total: 1,
        },
      ],
    } as unknown as IncomeReportView;
    expect(incomeCsv(view).rows[0][1]).toBe('2026-07-18');
  });

  it('keeps the full instant on a ledger, where the time is the point', () => {
    const view = {
      period: PERIOD,
      rows: [
        {
          id: 'payment:p-1',
          kind: 'payment',
          reference: 'TXN-8842',
          at: new Date('2026-07-18T09:30:00.000Z'),
          personName: 'Ploy Srisai',
          eventId: 'e-1',
          eventName: 'Tech Summit 2026',
          method: 'Card',
          amountSatang: 1,
          outcome: 'succeeded',
          paymentId: 'p-1',
        },
      ],
    } as unknown as TransactionsReportView;
    expect(transactionsCsv(view).rows[0][1]).toBe('2026-07-18T09:30:00.000Z');
  });
});

describe('wording a spreadsheet reads', () => {
  it('writes a fixed code’s terms in plain Baht, not in ฿', () => {
    // The PDF and the workbook say "฿200 off" to a person; the CSV keeps the
    // machine-friendly Baht it writes every other amount in.
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
    } as unknown as DiscountsReportView;

    expect(discountsCsv(view).rows[0][1]).toBe('200.00 off');
  });

  it('keeps a transaction’s type as the raw token, for a machine to match on', () => {
    // Capitalising it is a human-facing format's job; a spreadsheet filtering
    // on `refund` should not have to know which files title-case it.
    const view = {
      period: PERIOD,
      rows: [
        {
          id: 'refund:r-1',
          kind: 'refund',
          reference: 'RFD-1190',
          at: new Date('2026-07-18T09:30:00.000Z'),
          personName: 'Ploy Srisai',
          eventId: 'e-1',
          eventName: 'Tech Summit 2026',
          method: 'Card',
          amountSatang: 125_000,
          outcome: 'refunded',
          paymentId: 'p-1',
        },
      ],
    } as unknown as TransactionsReportView;

    expect(transactionsCsv(view).rows[0][2]).toBe('refund');
  });
});
