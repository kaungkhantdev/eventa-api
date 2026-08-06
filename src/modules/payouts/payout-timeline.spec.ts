import { maskAccount, payoutTimeline } from './payout-timeline';

describe('Payout presentation (US-FIN-03, US-FIN-04)', () => {
  describe('maskAccount', () => {
    it('shows only the last four digits', () => {
      expect(maskAccount('1234567890')).toBe('•••• 7890');
    });

    it('leaves an already-masked descriptor alone', () => {
      expect(maskAccount('•••• 7890')).toBe('•••• 7890');
    });

    it('says so plainly when no account is on file', () => {
      expect(maskAccount(null)).toBe('No bank account');
      expect(maskAccount('')).toBe('No bank account');
    });

    it('never leaks a short string it cannot safely mask', () => {
      // Fewer than four digits is not an account number; showing it whole
      // would be the one case where masking failed open.
      expect(maskAccount('12')).toBe('•••• ••••');
    });
  });

  describe('payoutTimeline', () => {
    it('walks requested → processing → paid', () => {
      const steps = payoutTimeline('paid');
      expect(steps.map((s) => s.step)).toEqual([
        'requested',
        'processing',
        'paid',
      ]);
      expect(steps.every((s) => s.done)).toBe(true);
    });

    it('marks a scheduled payout as only requested', () => {
      const steps = payoutTimeline('scheduled');
      expect(steps.find((s) => s.step === 'requested')?.done).toBe(true);
      expect(steps.find((s) => s.step === 'processing')?.done).toBe(false);
      expect(steps.find((s) => s.step === 'paid')?.done).toBe(false);
    });

    it('tells an organizer mid-transfer how long to expect to wait', () => {
      const steps = payoutTimeline('processing');
      expect(steps.find((s) => s.step === 'processing')?.done).toBe(true);
      expect(steps.find((s) => s.step === 'paid')?.done).toBe(false);
      expect(steps.find((s) => s.step === 'processing')?.note).toMatch(
        /1–3 business days/,
      );
    });

    it('says what went wrong on a failed payout rather than showing it as paid', () => {
      const steps = payoutTimeline('failed');
      expect(steps.find((s) => s.step === 'paid')?.done).toBe(false);
      expect(steps.find((s) => s.step === 'processing')?.note).toMatch(
        /could not be completed/i,
      );
    });
  });
});
