import {
  MONTHS_IN_YEAR,
  VAT_FILING_DAY,
  isLateFiling,
  monthLabel,
  periodDueDate,
  periodStatus,
  vatOnSales,
} from './vat-period';

describe('VAT periods (US-FIN-11, US-FIN-12)', () => {
  describe('periodDueDate', () => {
    it('falls on the 15th of the following month', () => {
      expect(periodDueDate(2026, 6)).toBe('2026-07-15');
      expect(VAT_FILING_DAY).toBe(15);
    });

    it('rolls December into January of the next year', () => {
      expect(periodDueDate(2026, 12)).toBe('2027-01-15');
    });
  });

  describe('monthLabel', () => {
    it('names each month', () => {
      expect(monthLabel(1)).toBe('Jan');
      expect(monthLabel(6)).toBe('Jun');
      expect(monthLabel(MONTHS_IN_YEAR)).toBe('Dec');
    });
  });

  describe('periodStatus', () => {
    it('is upcoming while the month is still running', () => {
      expect(periodStatus(2026, 6, '2026-06-30', false)).toBe('upcoming');
    });

    it('is upcoming for a month that has not started', () => {
      expect(periodStatus(2026, 9, '2026-06-15', false)).toBe('upcoming');
    });

    it('becomes due the day the month ends, not on the 15th', () => {
      // You file from the 1st; the 15th is the deadline, not the opening.
      expect(periodStatus(2026, 6, '2026-07-01', false)).toBe('due');
    });

    it('stays due past its deadline while unfiled', () => {
      expect(periodStatus(2026, 6, '2026-08-20', false)).toBe('due');
    });

    it('is filed once it has been filed, whatever the date', () => {
      expect(periodStatus(2026, 6, '2026-06-02', true)).toBe('filed');
    });
  });

  describe('isLateFiling', () => {
    it('is on time up to and including the due date', () => {
      expect(isLateFiling('2026-07-15', 2026, 6)).toBe(false);
      expect(isLateFiling('2026-07-01', 2026, 6)).toBe(false);
    });

    it('is late the day after', () => {
      expect(isLateFiling('2026-07-16', 2026, 6)).toBe(true);
    });
  });

  describe('vatOnSales', () => {
    it('splits a VAT-inclusive month into taxable sales and 7% VAT', () => {
      // The story's worked example: ฿3,012,800 of sales carries ฿210,896 VAT.
      const { salesSatang, vatSatang } = vatOnSales(322_369_600, 0.07);
      expect(vatSatang).toBe(21_089_600);
      expect(salesSatang).toBe(301_280_000);
      // VAT is exactly 7% of the taxable base it sits on.
      expect(Math.round(salesSatang * 0.07)).toBe(vatSatang);
    });

    it('nets a refunded month back to nothing', () => {
      expect(vatOnSales(0, 0.07)).toEqual({ salesSatang: 0, vatSatang: 0 });
    });

    it('carries a net-negative month rather than hiding it', () => {
      // More refunded than sold: the period genuinely owes less VAT.
      const { salesSatang, vatSatang } = vatOnSales(-10_700, 0.07);
      expect(vatSatang).toBe(-700);
      expect(salesSatang).toBe(-10_000);
    });
  });
});
