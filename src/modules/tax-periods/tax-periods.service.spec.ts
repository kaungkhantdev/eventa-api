import type { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import type { TaxPeriodsRepository } from './tax-periods.repository';
import { TaxPeriodsService } from './tax-periods.service';
import type { FiledPeriod, MonthlyTakings } from './tax-periods.types';
import type { TaxableSalesPort } from './ports/taxable-sales.port';

const ORG = 7;
const YEAR = 2026;
/** ฿3,223,696 gross → ฿3,012,800 taxable + ฿210,896 VAT, the story's example. */
const JUNE_GROSS = 322_369_600;
const JUNE_SALES = 301_280_000;
const JUNE_VAT = 21_089_600;
/** 20 Aug 2026, Bangkok — June is well past its 15 Jul deadline. */
const NOW = new Date('2026-08-20T02:00:00Z');

const auth: AuthContext = {
  userId: 'admin-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const takings = (o: Partial<MonthlyTakings> = {}): MonthlyTakings => ({
  year: YEAR,
  month: 6,
  grossSatang: JUNE_GROSS,
  ...o,
});

describe('TaxPeriodsService', () => {
  let repo: jest.Mocked<TaxPeriodsRepository>;
  let sales: jest.Mocked<TaxableSalesPort>;
  let service: TaxPeriodsService;

  beforeEach(() => {
    repo = {
      vatRate: jest.fn().mockResolvedValue(0.07),
      filedPeriods: jest.fn().mockResolvedValue([]),
      recordFiling: jest
        .fn()
        .mockImplementation((_o, input: FiledPeriod) => Promise.resolve(input)),
    } as unknown as jest.Mocked<TaxPeriodsRepository>;
    sales = {
      totalsByMonth: jest.fn().mockResolvedValue([takings()]),
    };
    const clock: Clock = { now: () => NOW };
    service = new TaxPeriodsService(repo, sales, clock);
  });

  const list = (o: Record<string, unknown> = {}) =>
    service.list(auth, { year: YEAR, ...o });

  describe('the monthly VAT ledger (US-FIN-11)', () => {
    it('shows 7% VAT on the month’s taxable sales', async () => {
      const { rows } = await list();
      const june = rows.find((r) => r.month === 6);
      expect(june?.salesSatang).toBe(JUNE_SALES);
      expect(june?.vatSatang).toBe(JUNE_VAT);
      expect(Math.round(JUNE_SALES * 0.07)).toBe(JUNE_VAT);
    });

    it('lists every month of the chosen year, not only the ones with sales', async () => {
      const { rows } = await list();
      expect(rows).toHaveLength(12);
      expect(rows.map((r) => r.period)).toContain('Jan');
      expect(rows.map((r) => r.period)).toContain('Dec');
    });

    it('dates each period on the 15th of the following month', async () => {
      const { rows } = await list();
      expect(rows.find((r) => r.month === 6)?.dueAt).toBe('2026-07-15');
      expect(rows.find((r) => r.month === 12)?.dueAt).toBe('2027-01-15');
    });

    it('marks past months due and future months upcoming', async () => {
      const { rows } = await list();
      expect(rows.find((r) => r.month === 6)?.status).toBe('due');
      expect(rows.find((r) => r.month === 12)?.status).toBe('upcoming');
    });

    it('keeps VAT payable equal to collected minus remitted', async () => {
      repo.filedPeriods.mockResolvedValue([
        {
          year: YEAR,
          month: 5,
          salesSatang: 100_000,
          vatSatang: 7_000,
          whtSatang: 0,
          remittedSatang: 7_000,
          filedAt: new Date('2026-06-10T00:00:00Z'),
        },
      ]);
      const { headlines } = await list();
      expect(headlines.vatCollectedSatang).toBe(JUNE_VAT + 7_000);
      expect(headlines.vatRemittedSatang).toBe(7_000);
      expect(headlines.vatPayableSatang).toBe(
        headlines.vatCollectedSatang - headlines.vatRemittedSatang,
      );
    });

    it('sums withholding separately from VAT payable', async () => {
      repo.filedPeriods.mockResolvedValue([
        {
          year: YEAR,
          month: 5,
          salesSatang: 100_000,
          vatSatang: 7_000,
          whtSatang: 3_000,
          remittedSatang: 7_000,
          filedAt: new Date('2026-06-10T00:00:00Z'),
        },
      ]);
      const { headlines } = await list();
      expect(headlines.withholdingSatang).toBe(3_000);
      expect(headlines.vatPayableSatang).toBe(JUNE_VAT);
    });

    it('reports a filed period’s FROZEN figures, not a fresh computation', async () => {
      // A refund landing after the return was filed must not rewrite it.
      repo.filedPeriods.mockResolvedValue([
        {
          year: YEAR,
          month: 6,
          salesSatang: 999,
          vatSatang: 70,
          whtSatang: 0,
          remittedSatang: 70,
          filedAt: new Date('2026-07-10T00:00:00Z'),
        },
      ]);
      const { rows } = await list();
      const june = rows.find((r) => r.month === 6);
      expect(june?.status).toBe('filed');
      expect(june?.vatSatang).toBe(70);
      expect(june?.salesSatang).toBe(999);
    });

    it('narrows to a filing status while the headlines still cover the year', async () => {
      const { rows, headlines } = await list({ status: 'due' });
      expect(rows.every((r) => r.status === 'due')).toBe(true);
      // The headline is the year's position, not the filtered slice's.
      expect(headlines.vatCollectedSatang).toBe(JUNE_VAT);
    });

    it('asks for the takings of the chosen year only', async () => {
      await list();
      expect(sales.totalsByMonth).toHaveBeenCalledWith(ORG, YEAR);
    });
  });

  describe('recording a filing (US-FIN-12)', () => {
    const file = (month = 6, o: Record<string, unknown> = {}) =>
      service.file(auth, { year: YEAR, month, ...o });

    it('freezes the period’s figures and remits its VAT', async () => {
      const result = await file();
      expect(repo.recordFiling).toHaveBeenCalledWith(
        ORG,
        expect.objectContaining({
          year: YEAR,
          month: 6,
          salesSatang: JUNE_SALES,
          vatSatang: JUNE_VAT,
          remittedSatang: JUNE_VAT,
        }),
      );
      expect(result.status).toBe('filed');
      expect(result.remittedSatang).toBe(JUNE_VAT);
    });

    it('drops VAT payable by what was remitted', async () => {
      const before = (await list()).headlines;
      expect(before.vatPayableSatang).toBe(JUNE_VAT);
      await file();
      repo.filedPeriods.mockResolvedValue([
        {
          year: YEAR,
          month: 6,
          salesSatang: JUNE_SALES,
          vatSatang: JUNE_VAT,
          whtSatang: 0,
          remittedSatang: JUNE_VAT,
          filedAt: NOW,
        },
      ]);
      const after = (await list()).headlines;
      expect(after.vatPayableSatang).toBe(0);
    });

    it('refuses a period that is not yet due', async () => {
      await expect(file(12)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(repo.recordFiling).not.toHaveBeenCalled();
    });

    it('refuses a period that is already filed', async () => {
      repo.filedPeriods.mockResolvedValue([
        {
          year: YEAR,
          month: 6,
          salesSatang: JUNE_SALES,
          vatSatang: JUNE_VAT,
          whtSatang: 0,
          remittedSatang: JUNE_VAT,
          filedAt: NOW,
        },
      ]);
      await expect(file()).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('flags a filing made after the deadline as late', async () => {
      // Filed 20 Aug for a June period due 15 Jul.
      const result = await file();
      expect(result.late).toBe(true);
    });

    it('does not flag a filing made on time', async () => {
      const onTime = new Date('2026-07-14T02:00:00Z');
      service = new TaxPeriodsService(repo, sales, { now: () => onTime });
      const result = await service.file(auth, { year: YEAR, month: 6 });
      expect(result.late).toBe(false);
    });

    it('records the withholding figure alongside the return', async () => {
      await file(6, { whtSatang: 3_000 });
      expect(repo.recordFiling).toHaveBeenCalledWith(
        ORG,
        expect.objectContaining({ whtSatang: 3_000 }),
      );
    });

    it('refuses a month outside the calendar', async () => {
      await expect(file(13)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });
});
