import {
  INVOICE_TERM_DAYS,
  ageInvoice,
  bangkokToday,
  dueDateFor,
} from './invoice-ageing';

describe('Invoice ageing (US-FIN-06)', () => {
  const TODAY = '2026-06-15';

  describe('bangkokToday', () => {
    it('reads the calendar date in Bangkok, not UTC', () => {
      // 18:30 UTC on the 14th is already 01:30 on the 15th in Bangkok (+07).
      expect(bangkokToday(new Date('2026-06-14T18:30:00Z'))).toBe('2026-06-15');
    });

    it('does not roll over early', () => {
      expect(bangkokToday(new Date('2026-06-14T16:59:00Z'))).toBe('2026-06-14');
    });
  });

  describe('dueDateFor', () => {
    it('falls 14 days after the issue date', () => {
      expect(dueDateFor('2026-06-15')).toBe('2026-06-29');
      expect(INVOICE_TERM_DAYS).toBe(14);
    });

    it('crosses a month boundary without drifting', () => {
      expect(dueDateFor('2026-01-25')).toBe('2026-02-08');
    });
  });

  describe('ageInvoice', () => {
    it('shows an unpaid invoice 3 days past its due date as overdue', () => {
      const aged = ageInvoice('issued', '2026-06-12', TODAY);
      expect(aged.status).toBe('overdue');
      expect(aged.daysUntilDue).toBe(-3);
    });

    it('shows an unpaid invoice due in 9 days as issued', () => {
      const aged = ageInvoice('issued', '2026-06-24', TODAY);
      expect(aged.status).toBe('issued');
      expect(aged.daysUntilDue).toBe(9);
    });

    it('treats the due date itself as still issued, not yet overdue', () => {
      const aged = ageInvoice('issued', TODAY, TODAY);
      expect(aged.status).toBe('issued');
      expect(aged.daysUntilDue).toBe(0);
    });

    it('never ages a paid invoice into overdue', () => {
      // Paying late settles the debt; the row must not keep chasing the buyer.
      expect(ageInvoice('paid', '2026-06-01', TODAY).status).toBe('paid');
    });

    it('never ages a voided invoice into overdue', () => {
      expect(ageInvoice('void', '2026-06-01', TODAY).status).toBe('void');
    });

    it('keeps a stored overdue row overdue', () => {
      expect(ageInvoice('overdue', '2026-06-01', TODAY).status).toBe('overdue');
    });
  });
});
