import {
  DECISION_HOLD_EXPIRY,
  isAwaitingApproval,
  placementFor,
  statusAfterRefund,
} from './approval-rules';

describe('approval rules (US-REG-02 — require approval, pay first)', () => {
  describe('placementFor', () => {
    it('a free order on an event that requires approval waits for the organizer at once, with no tickets', () => {
      expect(
        placementFor({
          requiresApproval: true,
          paymentRequired: false,
          organizerEntry: false,
        }),
      ).toEqual({
        issueTickets: false,
        requiresApproval: true,
        awaitsDecision: true,
      });
    });

    it('a paid order on such an event is placed for payment first — the wait starts when the money lands', () => {
      expect(
        placementFor({
          requiresApproval: true,
          paymentRequired: true,
          organizerEntry: false,
        }),
      ).toEqual({
        issueTickets: false,
        requiresApproval: true,
        awaitsDecision: false,
      });
    });

    it('an organizer entering a booking by hand is never held for their own approval (US-REG-03)', () => {
      expect(
        placementFor({
          requiresApproval: true,
          paymentRequired: false,
          organizerEntry: true,
        }),
      ).toEqual({
        issueTickets: true,
        requiresApproval: false,
        awaitsDecision: false,
      });
    });

    it('without the rule, a free order confirms at once and a paid one waits for its money', () => {
      const free = placementFor({
        requiresApproval: false,
        paymentRequired: false,
        organizerEntry: false,
      });
      const paid = placementFor({
        requiresApproval: false,
        paymentRequired: true,
        organizerEntry: false,
      });
      expect(free).toEqual({
        issueTickets: true,
        requiresApproval: false,
        awaitsDecision: false,
      });
      expect(paid).toEqual({
        issueTickets: false,
        requiresApproval: false,
        awaitsDecision: false,
      });
    });
  });

  describe('isAwaitingApproval', () => {
    const requested = new Date('2026-09-01T00:00:00Z');

    it('is a pending registration whose decision has been asked for', () => {
      expect(
        isAwaitingApproval({
          status: 'pending',
          approvalRequestedAt: requested,
        }),
      ).toBe(true);
    });

    it('is not a pending order still waiting for its money', () => {
      expect(
        isAwaitingApproval({ status: 'pending', approvalRequestedAt: null }),
      ).toBe(false);
    });

    it('is not a registration already decided', () => {
      for (const status of ['confirmed', 'rejected', 'cancelled'] as const) {
        expect(
          isAwaitingApproval({ status, approvalRequestedAt: requested }),
        ).toBe(false);
      }
    });
  });

  describe('statusAfterRefund', () => {
    it('keeps a rejection a rejection — the refund is its consequence, not a cancellation', () => {
      expect(statusAfterRefund('rejected')).toBe('rejected');
    });

    it('cancels anything else', () => {
      expect(statusAfterRefund('confirmed')).toBe('cancelled');
      expect(statusAfterRefund('pending')).toBe('cancelled');
    });
  });

  it('holds a seat for a decision until a date no clock will reach', () => {
    expect(DECISION_HOLD_EXPIRY.getUTCFullYear()).toBe(9999);
  });
});
