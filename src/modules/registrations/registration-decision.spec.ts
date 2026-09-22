import {
  APPROVE_BLOCKED_UNPAID,
  OFFER_NOT_WAITLISTED,
  REJECT_BLOCKED_PAID,
  canApprove,
  canOffer,
  canReject,
} from './registration-decision';

const pending = (o: Record<string, unknown> = {}) => ({
  status: 'pending' as const,
  paymentStatus: 'pending' as const,
  totalSatang: 0,
  ...o,
});

describe('Registration decisions (US-REG-02)', () => {
  describe('approving', () => {
    it('allows a free pending registration', () => {
      expect(canApprove(pending()).allowed).toBe(true);
    });

    it('allows a paid registration once the money is in', () => {
      expect(
        canApprove(pending({ totalSatang: 1000, paymentStatus: 'paid' }))
          .allowed,
      ).toBe(true);
    });

    it('blocks a paid registration that has not been paid', () => {
      const verdict = canApprove(
        pending({ totalSatang: 1000, paymentStatus: 'pending' }),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe(APPROVE_BLOCKED_UNPAID);
    });

    it('allows a waitlisted registration to be approved into a freed seat', () => {
      expect(canApprove(pending({ status: 'waitlisted' })).allowed).toBe(true);
    });

    it('never re-approves a rejected registration', () => {
      // The story is explicit: a rejection is terminal.
      const verdict = canApprove(pending({ status: 'rejected' }));
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toMatch(/rejected/i);
    });

    it('does not approve something already confirmed', () => {
      expect(canApprove(pending({ status: 'confirmed' })).allowed).toBe(false);
    });

    it('does not approve a cancelled registration', () => {
      expect(canApprove(pending({ status: 'cancelled' })).allowed).toBe(false);
    });
  });

  describe('rejecting', () => {
    it('allows rejecting a pending registration with no money captured', () => {
      expect(canReject(pending()).allowed).toBe(true);
    });

    it('allows rejecting a waitlisted registration', () => {
      expect(canReject(pending({ status: 'waitlisted' })).allowed).toBe(true);
    });

    it('refuses to reject once money has been captured, pointing at the refund', () => {
      // Rejecting a paid seat would strand the buyer's money outside the
      // refund ledger — the story sends the organizer to cancel-and-refund.
      const verdict = canReject(
        pending({ paymentStatus: 'paid', totalSatang: 1000 }),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe(REJECT_BLOCKED_PAID);
      expect(verdict.reason).toMatch(/refund/i);
    });

    it('refuses to reject an already-confirmed registration', () => {
      expect(canReject(pending({ status: 'confirmed' })).allowed).toBe(false);
    });

    it('refuses to reject twice', () => {
      expect(canReject(pending({ status: 'rejected' })).allowed).toBe(false);
    });
  });

  describe('offering a seat (US-REG-04)', () => {
    it('allows someone on the waitlist, paid ticket or free', () => {
      expect(
        canOffer(pending({ status: 'waitlisted', totalSatang: 1000 })).allowed,
      ).toBe(true);
      expect(canOffer(pending({ status: 'waitlisted' })).allowed).toBe(true);
    });

    it('refuses anybody who is not on the waitlist', () => {
      // A pending registration already has its seat; an offer would hold a
      // second one for the same person.
      for (const status of ['pending', 'confirmed', 'cancelled'] as const) {
        const verdict = canOffer(pending({ status }));
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toBe(OFFER_NOT_WAITLISTED);
      }
    });

    it('never offers a seat to a rejected registration', () => {
      expect(canOffer(pending({ status: 'rejected' })).reason).toMatch(
        /rejected/,
      );
    });
  });
});
