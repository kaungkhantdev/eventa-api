import { RegistrationDecisionsService } from './registration-decisions.service';
import type { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import type {
  DecidableOrder,
  RegistrationApprovalPort,
} from './ports/registration-approval.port';
import { APPROVE_BLOCKED_UNPAID } from './registration-decision';

const ORG = 7;
const ORDER = 'o-1';
const REFERENCE = 'ORD-2026-0009';

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

/** The thrown exception, so both its code and its wording can be asserted. */
const failure = (call: Promise<unknown>): Promise<DomainException> =>
  call.then(
    () => {
      throw new Error('expected the decision to be refused');
    },
    (error: DomainException) => error,
  );

const decidable = (o: Partial<DecidableOrder> = {}): DecidableOrder => ({
  id: ORDER,
  reference: REFERENCE,
  status: 'pending',
  paymentStatus: 'pending',
  totalSatang: 0,
  ...o,
});

describe('RegistrationDecisionsService (US-REG-02)', () => {
  let approvals: jest.Mocked<RegistrationApprovalPort>;
  let service: RegistrationDecisionsService;

  beforeEach(() => {
    approvals = {
      findDecidable: jest.fn().mockResolvedValue(decidable()),
      approve: jest.fn().mockResolvedValue({
        outcome: 'approved',
        reference: REFERENCE,
        ticketCount: 2,
        reason: null,
      }),
      reject: jest.fn().mockResolvedValue({ reference: REFERENCE }),
    };
    service = new RegistrationDecisionsService(approvals);
  });

  describe('approving', () => {
    it('issues the tickets for a free pending registration', async () => {
      const result = await service.approve(auth, ORDER);
      expect(result.outcome).toBe('approved');
      expect(result.ticketCount).toBe(2);
      expect(result.reference).toBe(REFERENCE);
    });

    it('records WHO decided it, so the audit trail names a person', async () => {
      await service.approve(auth, ORDER);
      expect(approvals.approve).toHaveBeenCalledWith(ORG, ORDER, 'u-1');
    });

    it('blocks a paid registration whose money has not arrived, without touching the order', async () => {
      approvals.findDecidable.mockResolvedValue(
        decidable({ totalSatang: 100_000, paymentStatus: 'pending' }),
      );
      await expect(service.approve(auth, ORDER)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: APPROVE_BLOCKED_UNPAID,
      });
      expect(approvals.approve).not.toHaveBeenCalled();
    });

    it('approves a paid registration once the money is in', async () => {
      approvals.findDecidable.mockResolvedValue(
        decidable({ totalSatang: 100_000, paymentStatus: 'paid' }),
      );
      await expect(service.approve(auth, ORDER)).resolves.toMatchObject({
        outcome: 'approved',
      });
    });

    it('leaves the registration pending and offers the waitlist when it sold out', async () => {
      // The story is explicit that approval does NOT cancel here — the seat is
      // simply gone, and the organizer is pointed at the waitlist.
      approvals.approve.mockResolvedValue({
        outcome: 'unavailable',
        reference: REFERENCE,
        ticketCount: 0,
        reason:
          'This ticket is now sold out — offer the attendee the waitlist instead.',
      });
      const error = await failure(service.approve(auth, ORDER));
      expect(error.code).toBe('CONFLICT');
      expect(error.message).toMatch(/waitlist/i);
    });

    it('issues nothing further when the same approval is retried', async () => {
      // The retry finds the registration ALREADY confirmed. That is not a
      // conflict — it is the state the caller asked for — so the decision goes
      // through to the settlement, which reports it without a second ticket.
      approvals.findDecidable.mockResolvedValue(
        decidable({ status: 'confirmed', paymentStatus: 'paid' }),
      );
      approvals.approve.mockResolvedValue({
        outcome: 'already_approved',
        reference: REFERENCE,
        ticketCount: 2,
        reason: null,
      });
      const result = await service.approve(auth, ORDER);
      expect(result.outcome).toBe('already_approved');
      expect(result.ticketCount).toBe(2);
    });

    it('refuses to re-approve a rejected registration', async () => {
      approvals.findDecidable.mockResolvedValue(
        decidable({ status: 'rejected' }),
      );
      const error = await failure(service.approve(auth, ORDER));
      expect(error.code).toBe('CONFLICT');
      expect(error.message).toMatch(/rejected/i);
      expect(approvals.approve).not.toHaveBeenCalled();
    });

    it('404s an order belonging to another workspace', async () => {
      approvals.findDecidable.mockResolvedValue(null);
      await expect(service.approve(auth, ORDER)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('rejecting', () => {
    it('releases the seat and records the reason', async () => {
      await service.reject(auth, ORDER, {
        confirm: true,
        reason: 'Duplicate sign-up',
      });
      expect(approvals.reject).toHaveBeenCalledWith(ORG, ORDER, {
        decidedBy: 'u-1',
        reason: 'Duplicate sign-up',
      });
    });

    it('demands an explicit confirmation, so one misclick cannot terminate it', async () => {
      await expect(
        service.reject(auth, ORDER, { confirm: false, reason: null }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(approvals.reject).not.toHaveBeenCalled();
    });

    it('refuses once money has been captured, pointing at the refund', async () => {
      approvals.findDecidable.mockResolvedValue(
        decidable({ paymentStatus: 'paid', totalSatang: 100_000 }),
      );
      const error = await failure(
        service.reject(auth, ORDER, { confirm: true, reason: null }),
      );
      expect(error.code).toBe('CONFLICT');
      expect(error.message).toMatch(/refund/i);
      expect(approvals.reject).not.toHaveBeenCalled();
    });

    it('refuses to reject an already-confirmed registration', async () => {
      approvals.findDecidable.mockResolvedValue(
        decidable({ status: 'confirmed' }),
      );
      await expect(
        service.reject(auth, ORDER, { confirm: true, reason: null }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('is a no-op, not a conflict, when the rejection is retried', async () => {
      approvals.findDecidable.mockResolvedValue(
        decidable({ status: 'rejected' }),
      );
      await expect(
        service.reject(auth, ORDER, { confirm: true, reason: null }),
      ).resolves.toMatchObject({ outcome: 'rejected' });
    });

    it('404s an order belonging to another workspace', async () => {
      approvals.findDecidable.mockResolvedValue(null);
      await expect(
        service.reject(auth, ORDER, { confirm: true, reason: null }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
