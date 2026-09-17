import type { ConfigService } from '@nestjs/config';
import type { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import type { OutboxPort } from '../platform/outbox.port';
import { Persona } from '../auth/auth.types';
import { PasswordResetService } from './auth-password-reset.service';
import { passwordFingerprint } from './auth-password-fingerprint';
import type { PasswordRepository } from './auth-password.repository';
import type { PasswordService } from './auth-password.service';
import type { TokenService } from '../auth/token.service';
import type { LoginThrottleService } from '../auth/login-throttle.service';
import { IDENTITY_PASSWORD_RESET_REQUESTED } from './events/password-reset-requested.event';

/**
 * The message a refusal carried. Typed, unlike `expect.stringMatching` inside
 * `toMatchObject`, which widens the whole object to `any` and takes the lint
 * with it.
 */
async function refusalFrom(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected the call to be refused, but it resolved');
}

const CURRENT_HASH = 'argon2-current-hash';
const FINGERPRINT = passwordFingerprint(CURRENT_HASH);
const user = {
  id: 'u1',
  organizationId: 7,
  name: 'Somchai',
  status: 'Active',
  passwordHash: CURRENT_HASH,
};

describe('PasswordResetService', () => {
  let repo: jest.Mocked<PasswordRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let tokens: jest.Mocked<TokenService>;
  let outbox: jest.Mocked<OutboxPort>;
  let throttle: jest.Mocked<LoginThrottleService>;
  let service: PasswordResetService;

  beforeEach(() => {
    repo = {
      findByEmailPersona: jest.fn().mockResolvedValue(user),
      currentHash: jest.fn().mockResolvedValue(CURRENT_HASH),
      setPassword: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PasswordRepository>;
    passwords = {
      hash: jest.fn().mockResolvedValue('NEWHASH'),
      verify: jest.fn().mockResolvedValue(false),
    };
    tokens = {
      signPasswordReset: jest.fn().mockResolvedValue('RTOKEN'),
      verifyPasswordReset: jest
        .fn()
        .mockResolvedValue({ sub: 'u1', org: 7, pv: FINGERPRINT }),
    } as unknown as jest.Mocked<TokenService>;
    outbox = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const clock: Clock = { now: () => new Date('2026-07-31T00:00:00.000Z') };
    const config = {
      getOrThrow: jest.fn().mockReturnValue('https://web.test'),
    } as unknown as ConfigService<Env, true>;
    throttle = {
      assertNotLocked: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LoginThrottleService>;
    service = new PasswordResetService(
      repo,
      passwords,
      tokens,
      outbox,
      throttle,
      clock,
      config,
    );
  });

  describe('forgot', () => {
    it('signs a fingerprinted token and enqueues a reset email for a known account', async () => {
      const res = await service.forgot('owner@acme.co.th');

      expect(res.message).toMatch(/on its way/i);
      expect(tokens.signPasswordReset).toHaveBeenCalledWith({
        userId: 'u1',
        organizationId: 7,
        passwordFingerprint: FINGERPRINT,
      });
      const event = outbox.enqueue.mock.calls[0][0];
      expect(event.routingKey).toBe(IDENTITY_PASSWORD_RESET_REQUESTED);
      expect(event.payload.resetUrl).toBe(
        'https://web.test/reset-password?token=RTOKEN',
      );
    });

    /**
     * A deliberate product decision, overriding the usual advice to answer
     * uniformly. Silence for an address with no account is indistinguishable
     * from a mail that was sent and lost, and people were being left to wait
     * for a link that could never arrive.
     *
     * The cost is real: this endpoint now confirms whether an account exists.
     * The throttle below is what keeps that from being a way to farm the list.
     */
    it('says plainly when no account matches, and sends nothing', async () => {
      repo.findByEmailPersona.mockResolvedValue(null);
      await expect(service.forgot('ghost@acme.co.th')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('names the audience it searched, so the other one can be tried', async () => {
      repo.findByEmailPersona.mockResolvedValue(null);
      await expect(
        refusalFrom(service.forgot('ghost@acme.co.th', Persona.Attendee)),
      ).resolves.toMatch(/attendee/i);
      repo.findByEmailPersona.mockResolvedValue(null);
      await expect(
        refusalFrom(service.forgot('ghost@acme.co.th')),
      ).resolves.toMatch(/organizer/i);
    });

    /**
     * An account with no password is a social-only sign-in. It exists, so the
     * "no account" answer would be a lie — and it has nothing to reset.
     */
    it('does not claim a social-only account is missing', async () => {
      repo.findByEmailPersona.mockResolvedValue({
        ...user,
        passwordHash: null,
      });
      await expect(
        refusalFrom(service.forgot('owner@acme.co.th')),
      ).resolves.toMatch(/google/i);
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('defaults to the organizer audience', async () => {
      await service.forgot('owner@acme.co.th');
      expect(repo.findByEmailPersona).toHaveBeenCalledWith(
        'owner@acme.co.th',
        Persona.Admin,
      );
    });
  });

  /**
   * Only an account that can actually sign in has a password worth resetting.
   *
   * Sign-in refuses anything but `Active`, and reset never touched `status` —
   * so an unconfirmed account could complete the whole flow, be told "please
   * sign in", and be refused at the door. A reset that ends somewhere its own
   * success message sends you, and fails, is worse than an honest refusal.
   */
  describe('forgot — an account has to be usable to be reset', () => {
    it('refuses an unconfirmed account and says what to do instead', async () => {
      repo.findByEmailPersona.mockResolvedValue({
        ...user,
        status: 'Unconfirmed',
      });
      await expect(
        refusalFrom(service.forgot('owner@acme.co.th')),
      ).resolves.toMatch(/confirm/i);
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    /**
     * Deliberately no fresh confirmation email from here. Sign-in resends one,
     * but only AFTER a correct password; this endpoint takes no credential at
     * all, so sending from it would make it an unauthenticated way to fill
     * somebody's inbox.
     */
    it('sends nothing at all when it refuses', async () => {
      repo.findByEmailPersona.mockResolvedValue({
        ...user,
        status: 'Unconfirmed',
      });
      await expect(service.forgot('owner@acme.co.th')).rejects.toBeDefined();
      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(tokens.signPasswordReset).not.toHaveBeenCalled();
    });

    it('refuses a suspended account, pointing at the person who can undo it', async () => {
      repo.findByEmailPersona.mockResolvedValue({
        ...user,
        status: 'Suspended',
      });
      await expect(
        refusalFrom(service.forgot('owner@acme.co.th')),
      ).resolves.toMatch(/suspend/i);
    });

    it('refuses an unaccepted invitation, naming the invitation', async () => {
      repo.findByEmailPersona.mockResolvedValue({ ...user, status: 'Invited' });
      await expect(
        refusalFrom(service.forgot('owner@acme.co.th')),
      ).resolves.toMatch(/invitation/i);
    });

    /** A blocked status is the account's own state, not a wrong guess at it. */
    it('does not count a blocked status against the brute-force lock', async () => {
      repo.findByEmailPersona.mockResolvedValue({
        ...user,
        status: 'Unconfirmed',
      });
      await expect(service.forgot('owner@acme.co.th')).rejects.toBeDefined();
      expect(throttle.recordFailure).not.toHaveBeenCalled();
    });
  });

  /**
   * The mitigation the plain answer above requires.
   *
   * Once a reset form tells a registered address from an unknown one, it is a
   * membership oracle — so a miss is counted per identity exactly as a failed
   * sign-in is, and enough of them lock the identity out for a cool-off. A
   * scripted sweep gets a handful of answers and then a 429; a person who
   * mistyped their own address gets an honest one.
   */
  describe('forgot — throttling the oracle it creates', () => {
    it('refuses while the identity is in a cool-off', async () => {
      throttle.assertNotLocked.mockRejectedValue(
        Object.assign(new Error('locked'), { code: 'TOO_MANY_REQUESTS' }),
      );
      await expect(service.forgot('ghost@acme.co.th')).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
      });
      // Refused before the lookup: a locked identity learns nothing at all.
      expect(repo.findByEmailPersona).not.toHaveBeenCalled();
    });

    it('counts a miss against the identity that was probed', async () => {
      repo.findByEmailPersona.mockResolvedValue(null);
      await expect(service.forgot('ghost@acme.co.th')).rejects.toBeDefined();
      expect(throttle.recordFailure).toHaveBeenCalledWith(
        expect.stringContaining('ghost@acme.co.th'),
      );
    });

    it('keys the count per audience — two realms are two identities', async () => {
      repo.findByEmailPersona.mockResolvedValue(null);
      await expect(
        service.forgot('ghost@acme.co.th', Persona.Attendee),
      ).rejects.toBeDefined();
      const [identity] = throttle.recordFailure.mock.calls[0];
      expect(identity).toContain(Persona.Attendee);
    });

    it('counts nothing against an address that does have an account', async () => {
      await service.forgot('owner@acme.co.th');
      expect(throttle.recordFailure).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('sets a new password and signs out every device on a valid link', async () => {
      const res = await service.reset('RTOKEN', 'brandnew1pass');
      expect(passwords.hash).toHaveBeenCalledWith('brandnew1pass');
      expect(repo.setPassword).toHaveBeenCalledWith(7, 'u1', 'NEWHASH');
      expect(res.message).toMatch(/reset/i);
    });

    it('rejects an invalid/expired token (422)', async () => {
      tokens.verifyPasswordReset.mockRejectedValue(new Error('bad'));
      await expect(service.reset('bad', 'brandnew1pass')).rejects.toMatchObject(
        {
          code: 'VALIDATION_ERROR',
        },
      );
    });

    it('rejects a stale/used link whose fingerprint no longer matches (422)', async () => {
      repo.currentHash.mockResolvedValue('a-different-hash');
      await expect(
        service.reset('RTOKEN', 'brandnew1pass'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.setPassword).not.toHaveBeenCalled();
    });

    it('rejects reusing the current password (422)', async () => {
      passwords.verify.mockResolvedValue(true);
      await expect(
        service.reset('RTOKEN', 'brandnew1pass'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.setPassword).not.toHaveBeenCalled();
    });
  });
});
