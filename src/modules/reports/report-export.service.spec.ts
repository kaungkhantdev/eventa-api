import { UTF8_BOM } from '../../common/csv/csv';
import { EXPORT_MIME } from '../../common/export/tabular';
import { Clock } from '../../common/time/clock';
import { organizerAuth } from '../../../test/support/auth-context';
import type { AttendanceReportService } from './attendance-report.service';
import type { DiscountsReportService } from './discounts-report.service';
import type { EventsReportService } from './events-report.service';
import type { IncomeReportService } from './income-report.service';
import type { ReportScopePort } from './ports/report-scope.port';
import type { RegistrationsReportService } from './registrations-report.service';
import { ReportExportService } from './report-export.service';
import type { TransactionsReportService } from './transactions-report.service';

/**
 * Turning a report into a file (US-RPT-11).
 *
 * The two rules worth a test: an export is the WHOLE filtered set rather than
 * the page that happened to be on screen, and the file records the moment its
 * figures were taken.
 */

const GENERATED = new Date('2026-09-22T07:05:00.000Z');

const PERIOD = {
  from: new Date('2026-07-01T00:00:00+07:00'),
  to: new Date('2026-08-01T00:00:00+07:00'),
  previousFrom: new Date('2026-06-01T00:00:00+07:00'),
  previousTo: new Date('2026-07-01T00:00:00+07:00'),
  days: 31,
  trimmed: false,
};

const INCOME_VIEW = {
  period: PERIOD,
  rows: [
    {
      eventId: 'e-1',
      eventName: 'Tech Summit 2026',
      startAt: new Date('2026-07-18T02:00:00.000Z'),
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
};

class FixedClock extends Clock {
  now(): Date {
    return GENERATED;
  }
}

function build(eventName: string | null = 'Charity Gala') {
  const load = jest.fn().mockResolvedValue(INCOME_VIEW);
  const income = { load } as unknown as IncomeReportService;
  const scope = {
    eventName: jest.fn().mockResolvedValue(eventName),
  } as unknown as ReportScopePort;
  const other = { load: jest.fn().mockResolvedValue(INCOME_VIEW) };
  const service = new ReportExportService(
    other as unknown as RegistrationsReportService,
    other as unknown as AttendanceReportService,
    other as unknown as EventsReportService,
    income,
    other as unknown as DiscountsReportService,
    other as unknown as TransactionsReportService,
    scope,
    new FixedClock(),
  );
  return { service, load, scope };
}

describe('what an export covers', () => {
  it('loads the whole filtered set, whatever page the reader was on', async () => {
    // The file is the report, not the twenty rows that were visible.
    const { service, load } = build();
    await service.incomeFile(organizerAuth(), { page: 4, limit: 20 });
    expect(load).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ page: 1, limit: 5000 }),
    );
  });

  it('keeps every other filter exactly as the reader set it', async () => {
    const { service, load } = build();
    await service.incomeFile(organizerAuth(), { q: 'gala', eventId: 'e-1' });
    expect(load).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ q: 'gala', eventId: 'e-1' }),
    );
  });
});

describe('what the file says it covers', () => {
  it('names the filtered event, asked of the reader’s own workspace', async () => {
    const { service, scope } = build();
    const doc = await service.incomeFile(organizerAuth(), { eventId: 'e-1' });
    expect(scope.eventName).toHaveBeenCalledWith(1, 'e-1');
    expect(doc.filters).toContainEqual({
      label: 'Event',
      value: 'Charity Gala',
    });
  });

  it('does not go looking for a name when no event was picked', async () => {
    const { service, scope } = build();
    const doc = await service.incomeFile(organizerAuth(), {});
    expect(scope.eventName).not.toHaveBeenCalled();
    expect(doc.filters).toContainEqual({ label: 'Event', value: 'All events' });
  });

  it('records the moment the figures were taken', async () => {
    // US-RPT-11: "the file records that timestamp".
    const { service } = build();
    const doc = await service.incomeFile(organizerAuth(), {});
    expect(doc.generatedAt).toEqual(GENERATED);
  });
});

describe('the file that comes back', () => {
  it('labels a workbook as one, and names it after the report', async () => {
    const { service } = build();
    const doc = await service.incomeFile(organizerAuth(), {});
    const file = await service.file('income', 'xlsx', doc);
    expect(file.type).toBe(EXPORT_MIME.xlsx);
    expect(file.filename).toBe('income.xlsx');
    // A real workbook: `PK`, the zip magic every .xlsx starts with.
    expect(file.body.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('keeps the CSV’s byte-order mark, which is what makes Thai readable', async () => {
    const { service } = build();
    const doc = await service.incomeFile(organizerAuth(), {});
    const file = await service.file('income', 'csv', doc);
    expect(file.body.toString('utf8').startsWith(UTF8_BOM)).toBe(true);
    expect(file.type).toBe(EXPORT_MIME.csv);
    expect(file.filename).toBe('income.csv');
  });

  it('produces a real PDF', async () => {
    const { service } = build();
    const doc = await service.incomeFile(organizerAuth(), {});
    const file = await service.file('income', 'pdf', doc);
    expect(file.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(file.type).toBe(EXPORT_MIME.pdf);
    expect(file.filename).toBe('income.pdf');
  });
});
