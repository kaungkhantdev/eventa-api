import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import type { LoginThrottleService } from '../auth/login-throttle.service';
import type { PasswordService } from '../auth-password/auth-password.service';
import type { AuthTwoFactorService } from '../auth-two-factor/auth-two-factor.service';
import type { AccountDeletionRepository } from './account-deletion.repository';
import { AccountDeletionService } from './account-deletion.service';
import type {
  AccountRow,
  UpcomingPaidOrderRow,
} from './account-deletion.types';

const USER_ID = 'u-1';
const ORG = 7;

const auth: AuthContext = {
  userId: USER_ID,
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'attendee',
};

function account(o: Partial<AccountRow> = {}): AccountRow {
  return {
    id: USER_ID,
    organizationId: ORG,
    persona: 'attendee',
    name: 'Anan',
    email: 'anan@example.com',
    passwordHash: 'argon2-hash',
    ...o,
  };
}

const paidOrder = (
  o: Partial<UpcomingPaidOrderRow> = {},
): UpcomingPaidOrderRow => ({
  reference: 'ORD-7K2M9QX4',
  eventName: 'Bangkok Tech Week',
  startAt: new Date('2026-09-01T02:00:00Z'),
  ticketCount: 2,
  totalSatang: 188_000,
  ...o,
});

describe('AccountDeletionService (US-DISC-14)', () => {
  let repo: jest.Mocked<AccountDeletionRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let twoFactor: jest.Mocked<AuthTwoFactorService>;
  let throttle: jest.Mocked<LoginThrottleService>;
  let service: AccountDeletionService;

  beforeEach(() => {
    repo = {
      findAccount: jest.fn().mockResolvedValue(account()),
      upcomingPaidOrders: jest.fn().mockResolvedValue([]),
      scheduleDeletion: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<AccountDeletionRepository>;
    passwords = {
      verify: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<PasswordService>;
    twoFactor = {
      status: jest.fn().mockResolvedValue({
        enabled: false,
        pending: false,
        recoveryCodesRemaining: 0,
      }),
      verify: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<AuthTwoFactorService>;
    throttle = {
      assertNotLocked: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LoginThrottleService>;
    service = new AccountDeletionService(repo, passwords, twoFactor, throttle);
  });

  const enrol = () =>
    twoFactor.status.mockResolvedValue({
      enabled: true,
      pending: false,
      recoveryCodesRemaining: 8,
    });

  describe('warning (the danger-zone preflight)', () => {
    it('lists the upcoming paid orders that will NOT be refunded', async () => {
      repo.upcomingPaidOrders.mockResolvedValue([
        paidOrder(),
        paidOrder({
          reference: 'ORD-2222AAAA',
          totalSatang: 50_000,
          ticketCount: 1,
        }),
      ]);
      const result = await service.warning(auth);
      expect(repo.upcomingPaidOrders).toHaveBeenCalledWith('anan@example.com');
      expect(result.upcomingPaidOrders).toHaveLength(2);
      expect(result.upcomingPaidOrders[0].totalSatang).toBe(188_000);
      expect(result.totalAtRiskSatang).toBe(238_000);
    });

    it('tells the client whether re-verification needs an authenticator code', async () => {
      enrol();
      const result = await service.warning(auth);
      expect(result.requiresTwoFactorCode).toBe(true);
    });

    it('is for attendees only — a workspace member is refused', async () => {
      repo.findAccount.mockResolvedValue(account({ persona: 'admin' }));
      await expect(service.warning(auth)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('deleteAccount', () => {
    const del = (o: Record<string, unknown> = {}) =>
      service.deleteAccount(auth, { password: 'correct horse', ...o });

    it('re-verifies the password, then schedules deletion with the outbox event in-tx', async () => {
      const result = await del();
      expect(passwords.verify).toHaveBeenCalledWith(
        'argon2-hash',
        'correct horse',
      );
      const [orgArg, userArg, eventArg] = repo.scheduleDeletion.mock.calls[0];
      expect(orgArg).toBe(ORG);
      expect(userArg).toBe(USER_ID);
      expect(eventArg.routingKey).toBe('identity.account_deletion_requested');
      expect(eventArg.aggregateId).toBe(USER_ID);
      expect(eventArg.payload).toMatchObject({
        version: 1,
        email: 'anan@example.com',
        name: 'Anan',
      });
      expect(result.message).toMatch(/signed out/i);
    });

    it('a social-sign-in account (no password) must set one first — 403, nothing deleted', async () => {
      repo.findAccount.mockResolvedValue(account({ passwordHash: null }));
      const err = await del().catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(403);
      expect((err as DomainException).message).toMatch(/set a password/i);
      expect(passwords.verify).not.toHaveBeenCalled();
      expect(repo.scheduleDeletion).not.toHaveBeenCalled();
    });

    it('a wrong password aborts — 403 and the account is untouched', async () => {
      passwords.verify.mockResolvedValue(false);
      const err = await del().catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(403);
      expect(repo.scheduleDeletion).not.toHaveBeenCalled();
    });

    it('with 2FA enrolled, no code means no deletion', async () => {
      enrol();
      await expect(del()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(twoFactor.verify).not.toHaveBeenCalled();
      expect(repo.scheduleDeletion).not.toHaveBeenCalled();
    });

    it('with 2FA enrolled, a wrong code aborts with 403', async () => {
      enrol();
      twoFactor.verify.mockResolvedValue(false);
      const err = await del({ code: '000000' }).catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(403);
      expect(repo.scheduleDeletion).not.toHaveBeenCalled();
    });

    it('with 2FA enrolled, a valid code lets deletion proceed', async () => {
      enrol();
      await del({ code: '123456' });
      expect(twoFactor.verify).toHaveBeenCalledWith(ORG, USER_ID, '123456');
      expect(repo.scheduleDeletion).toHaveBeenCalled();
    });

    it('a workspace member cannot delete their account here', async () => {
      repo.findAccount.mockResolvedValue(account({ persona: 'admin' }));
      await expect(del()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(repo.scheduleDeletion).not.toHaveBeenCalled();
    });

    it('re-verification is throttled like sign-in — a locked account is refused before any check', async () => {
      throttle.assertNotLocked.mockRejectedValue(
        DomainException.tooManyRequests('Locked.'),
      );
      await expect(del()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(passwords.verify).not.toHaveBeenCalled();
      expect(repo.scheduleDeletion).not.toHaveBeenCalled();
    });

    it('a wrong password counts a strike against the account', async () => {
      passwords.verify.mockResolvedValue(false);
      await del().catch(() => undefined);
      expect(throttle.recordFailure).toHaveBeenCalledWith(`delete|${USER_ID}`);
    });

    it('a wrong 2FA code counts a strike against the account', async () => {
      enrol();
      twoFactor.verify.mockResolvedValue(false);
      await del({ code: '000000' }).catch(() => undefined);
      expect(throttle.recordFailure).toHaveBeenCalledWith(`delete|${USER_ID}`);
    });

    it('a completed re-verification clears the strikes', async () => {
      await del();
      expect(throttle.recordSuccess).toHaveBeenCalledWith(`delete|${USER_ID}`);
    });

    it('an account that vanished mid-flight is refused with 401', async () => {
      repo.findAccount.mockResolvedValue(null);
      await expect(del()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('a concurrent deletion (repo reports nothing to delete) is refused, not doubled', async () => {
      repo.scheduleDeletion.mockResolvedValue(false);
      await expect(del()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });
});
