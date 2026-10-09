import { createHash } from 'node:crypto';
import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { ResendThrottleService } from '../../common/throttle/resend-throttle.service';
import { organizerAuth } from '../../../test/support/auth-context';
import { IDENTITY_PHONE_VERIFICATION_REQUESTED } from './events/phone-verification-requested.event';
import { PhoneVerificationService } from './phone-verification.service';
import type { ProfileRepository } from './profile.repository';
import type { PhoneChallengeRow, ProfileRow } from './users.types';

const orgId = 1;
const userId = 'u1';
const auth = organizerAuth({ organizationId: orgId, userId });

const NOW = new Date('2026-10-09T03:00:00.000Z');
const TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;

const OLD_PHONE = '+66811111111';
const NEW_PHONE = '+66822222222';

/** The config this service reads — the two knobs, no literals. */
const config = {
  get: (key: string) =>
    key === 'LOGIN_MAX_ATTEMPTS' ? MAX_ATTEMPTS : TTL_SECONDS,
} as never;

function profileRow(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: userId,
    organizationId: orgId,
    name: 'Somchai',
    email: 'somchai@acme.test',
    pendingEmail: null,
    phone: OLD_PHONE,
    phoneVerifiedAt: NOW,
    pendingPhone: null,
    timezone: null,
    locale: null,
    city: null,
    dateOfBirth: null,
    bio: null,
    displayCurrency: null,
    avatarUrl: null,
    ...overrides,
  };
}

function challenge(
  overrides: Partial<PhoneChallengeRow> = {},
): PhoneChallengeRow {
  return {
    pendingPhone: NEW_PHONE,
    phoneCodeHash: sha256('123456'),
    phoneCodeExpiresAt: new Date(NOW.getTime() + TTL_SECONDS * 1000),
    phoneCodeAttempts: 0,
    ...overrides,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('PhoneVerificationService (US-DISC-11 AC3)', () => {
  let repo: jest.Mocked<ProfileRepository>;
  let throttle: jest.Mocked<ResendThrottleService>;
  let service: PhoneVerificationService;

  let claimed = 0;

  beforeEach(() => {
    claimed = 0;
    repo = {
      find: jest.fn().mockResolvedValue(profileRow()),
      startPhoneChange: jest
        .fn()
        .mockImplementation((_o, _u, values: { pendingPhone: string }) =>
          Promise.resolve(profileRow({ pendingPhone: values.pendingPhone })),
        ),
      findPhoneChallenge: jest.fn().mockResolvedValue(challenge()),
      recordPhoneCodeFailure: jest.fn().mockResolvedValue(1),
      /**
       * A faithful single-row model, not a constant.
       *
       * The statement increments and gates in one go, so what matters is that
       * only the first `MAX_ATTEMPTS` callers get a hash back. A stub that
       * always answered would hide exactly the race this method exists to
       * close — which is how the two-step version passed its own tests.
       */
      claimPhoneCodeAttempt: jest.fn().mockImplementation(() => {
        if (claimed >= MAX_ATTEMPTS) return Promise.resolve(null);
        claimed += 1;
        const row = challenge();
        return Promise.resolve({
          phoneCodeHash: row.phoneCodeHash,
          phoneCodeExpiresAt: row.phoneCodeExpiresAt,
          pendingPhone: row.pendingPhone,
        });
      }),
      promotePhone: jest
        .fn()
        .mockImplementation((_o, _u, phone: string) =>
          Promise.resolve(
            profileRow({ phone, pendingPhone: null, phoneVerifiedAt: NOW }),
          ),
        ),
      clearPhone: jest.fn().mockResolvedValue(
        profileRow({
          phone: null,
          phoneVerifiedAt: null,
          pendingPhone: null,
        }),
      ),
    } as unknown as jest.Mocked<ProfileRepository>;
    throttle = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
      remember: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ResendThrottleService>;
    const clock: Clock = { now: () => NOW };
    service = new PhoneVerificationService(repo, throttle, clock, config);
  });

  /** The values handed to the one write that starts a change. */
  const started = () => repo.startPhoneChange.mock.calls[0];

  describe('request', () => {
    it('holds the new number and texts the code from the same write', async () => {
      const res = await service.request(auth, NEW_PHONE);

      const [org, user, values, event] = started();
      expect([org, user]).toEqual([orgId, userId]);
      expect(values.pendingPhone).toBe(NEW_PHONE);
      expect(event.routingKey).toBe(IDENTITY_PHONE_VERIFICATION_REQUESTED);
      expect(event.payload).toMatchObject({
        version: 1,
        organizationId: orgId,
        userId,
        phone: NEW_PHONE,
      });
      // the number in use is untouched until the code comes back
      expect(res).toMatchObject({
        phone: OLD_PHONE,
        pendingPhone: NEW_PHONE,
        phoneVerified: true,
      });
    });

    it('stores only the hash of the code it sent', async () => {
      await service.request(auth, NEW_PHONE);
      const [, , values, event] = started();
      const code = (event.payload as { code: string }).code;

      expect(code).toMatch(/^\d{6}$/);
      expect(values.codeHash).toBe(sha256(code));
      expect(values.codeHash).not.toContain(code);
    });

    it('expires the code after the configured TTL', async () => {
      await service.request(auth, NEW_PHONE);
      const [, , values] = started();
      expect(values.expiresAt).toEqual(
        new Date(NOW.getTime() + TTL_SECONDS * 1000),
      );
    });

    it('normalises what the member typed into a textable number', async () => {
      await service.request(auth, '081 234-5678');
      expect(started()[2].pendingPhone).toBe('+66812345678');
    });

    it('refuses a number that cannot receive a text, before any send', async () => {
      await expect(service.request(auth, '021234567')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(repo.startPhoneChange).not.toHaveBeenCalled();
      expect(throttle.remember).not.toHaveBeenCalled();
    });

    it('refuses the number already confirmed on the account', async () => {
      await expect(service.request(auth, OLD_PHONE)).rejects.toBeInstanceOf(
        DomainException,
      );
      expect(repo.startPhoneChange).not.toHaveBeenCalled();
    });

    it('lets a number on file but never confirmed be confirmed', async () => {
      repo.find.mockResolvedValue(
        profileRow({ phone: OLD_PHONE, phoneVerifiedAt: null }),
      );
      await service.request(auth, OLD_PHONE);
      expect(started()[2].pendingPhone).toBe(OLD_PHONE);
    });

    it('refuses a second code inside the cool-off, and sends nothing', async () => {
      throttle.assertAllowed.mockRejectedValue(
        DomainException.tooManyRequests('wait'),
      );
      await expect(service.request(auth, NEW_PHONE)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      expect(repo.startPhoneChange).not.toHaveBeenCalled();
    });

    it('keys the cool-off on the account, not the number', async () => {
      await service.request(auth, NEW_PHONE);
      const [identity] = throttle.remember.mock.calls[0];
      expect(identity).toContain(userId);
      expect(identity).not.toContain(NEW_PHONE);
    });

    it('changing the number again replaces the code in flight', async () => {
      await service.request(auth, NEW_PHONE);
      await service.request(auth, '+66833333333');
      const first = started()[2];
      const second = repo.startPhoneChange.mock.calls[1][2];
      expect(second.pendingPhone).toBe('+66833333333');
      expect(second.codeHash).not.toBe(first.codeHash);
    });
  });

  describe('confirm', () => {
    it('promotes the held number once the code matches', async () => {
      const res = await service.confirm(auth, '123456');
      expect(repo.promotePhone).toHaveBeenCalledWith(orgId, userId, NEW_PHONE);
      expect(res).toMatchObject({
        phone: NEW_PHONE,
        pendingPhone: null,
        phoneVerified: true,
      });
    });

    it('spends a guess and refuses a wrong code', async () => {
      await expect(service.confirm(auth, '000000')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      // The guess was claimed in the statement that handed back the hash, so
      // the budget moved whether or not the comparison succeeded.
      expect(repo.claimPhoneCodeAttempt).toHaveBeenCalledWith(
        orgId,
        userId,
        MAX_ATTEMPTS,
      );
      expect(repo.promotePhone).not.toHaveBeenCalled();
    });

    /*
     * THE RACE THE ATOMIC CLAIM EXISTS FOR.
     *
     * `confirm` used to read the challenge, compare in memory, and increment
     * afterwards — with no row lock. So every request that read before the
     * first increment committed got its guess compared: 40 concurrent calls
     * produced 39 counted failures, the cap of five never fired, and a correct
     * guess arriving fortieth still promoted the number. The bound was pool
     * size times replicas, not the cap.
     *
     * The repository stub here models one row faithfully, so the cap binds only
     * if the service really claims before comparing.
     */
    it('lets no more than the cap through, however many arrive at once', async () => {
      const wrong = Array.from({ length: 40 }, () =>
        service.confirm(auth, '000000').catch(() => undefined),
      );
      await Promise.all(wrong);

      expect(repo.claimPhoneCodeAttempt).toHaveBeenCalledTimes(40);
      // Five guesses compared, thirty-five refused without one.
      expect(claimed).toBe(MAX_ATTEMPTS);

      // And the right code, arriving after the budget is spent, is not enough.
      await expect(service.confirm(auth, '123456')).rejects.toMatchObject({
        code: 'PHONE_CODE_EXPIRED',
      });
      expect(repo.promotePhone).not.toHaveBeenCalled();
    });

    it('refuses once the cap is spent', async () => {
      claimed = MAX_ATTEMPTS;
      await expect(service.confirm(auth, '000000')).rejects.toMatchObject({
        code: 'PHONE_CODE_EXPIRED',
      });
    });

    it('refuses an expired code and asks for a new one', async () => {
      repo.claimPhoneCodeAttempt.mockResolvedValue({
        phoneCodeHash: challenge().phoneCodeHash ?? '',
        phoneCodeExpiresAt: new Date(NOW.getTime() - 1),
        pendingPhone: NEW_PHONE,
      });
      await expect(service.confirm(auth, '123456')).rejects.toMatchObject({
        code: 'PHONE_CODE_EXPIRED',
      });
      expect(repo.promotePhone).not.toHaveBeenCalled();
    });

    it('refuses when nothing is awaiting confirmation', async () => {
      repo.claimPhoneCodeAttempt.mockResolvedValue(null);
      await expect(service.confirm(auth, '123456')).rejects.toBeInstanceOf(
        DomainException,
      );
    });
  });

  describe('remove', () => {
    it('clears the number and anything in flight', async () => {
      const res = await service.remove(auth);
      expect(repo.clearPhone).toHaveBeenCalledWith(orgId, userId);
      expect(res).toMatchObject({
        phone: null,
        pendingPhone: null,
        phoneVerified: false,
      });
    });
  });
});
