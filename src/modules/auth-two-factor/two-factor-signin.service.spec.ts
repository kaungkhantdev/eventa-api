import { DomainException } from '../../common/errors/domain.exception';
import type { AuthService } from '../auth/auth.service';
import type { LoginThrottleService } from '../auth/login-throttle.service';
import type { TokenService } from '../auth/token.service';
import type { TwoFactorChallengeClaims } from '../auth/auth.types';
import type { UsersRepository } from '../users/users.repository';
import type { AuthTwoFactorService } from './auth-two-factor.service';
import { TwoFactorSignInService } from './two-factor-signin.service';

const USER_ID = 'u-1';
const ORG = 7;

function claims(
  o: Partial<TwoFactorChallengeClaims> = {},
): TwoFactorChallengeClaims {
  return {
    sub: USER_ID,
    org: ORG,
    persona: 'attendee',
    rem: false,
    typ: 'twofa',
    ...o,
  };
}

const profile = (o: Record<string, unknown> = {}) => ({
  user: {
    id: USER_ID,
    organizationId: ORG,
    persona: 'attendee',
    status: 'Active',
    twoFactorEnabled: true,
    ...o,
  },
  org: { id: ORG },
});

describe('TwoFactorSignInService (US-ACC-05 / US-DISC-12)', () => {
  let tokens: jest.Mocked<TokenService>;
  let throttle: jest.Mocked<LoginThrottleService>;
  let users: jest.Mocked<UsersRepository>;
  let twoFactor: jest.Mocked<AuthTwoFactorService>;
  let auth: jest.Mocked<AuthService>;
  let service: TwoFactorSignInService;

  beforeEach(() => {
    tokens = {
      verifyTwoFactorChallenge: jest.fn().mockResolvedValue(claims()),
    } as unknown as jest.Mocked<TokenService>;
    throttle = {
      assertNotLocked: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LoginThrottleService>;
    users = {
      findProfile: jest.fn().mockResolvedValue(profile()),
    } as unknown as jest.Mocked<UsersRepository>;
    twoFactor = {
      verify: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<AuthTwoFactorService>;
    auth = {
      startSession: jest.fn().mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
      }),
    } as unknown as jest.Mocked<AuthService>;
    service = new TwoFactorSignInService(
      tokens,
      throttle,
      users,
      twoFactor,
      auth,
    );
  });

  const complete = (o: Record<string, unknown> = {}) =>
    service.complete({
      challengeToken: 'challenge.jwt',
      code: '123456',
      device: 'jest',
      ip: null,
      ...o,
    });

  it('opens the session once the code checks out', async () => {
    const result = await complete();
    expect(twoFactor.verify).toHaveBeenCalledWith(ORG, USER_ID, '123456');
    const [foundArg, sessionArg] = auth.startSession.mock.calls[0];
    expect(foundArg.user.id).toBe(USER_ID);
    expect(sessionArg).toMatchObject({ device: 'jest', rememberMe: false });
    expect(result.accessToken).toBe('a');
  });

  it('honours the remember-me chosen at the password step', async () => {
    tokens.verifyTwoFactorChallenge.mockResolvedValue(claims({ rem: true }));
    await complete();
    expect(auth.startSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rememberMe: true }),
    );
  });

  it('refuses a wrong code, counts the strike, and opens nothing', async () => {
    twoFactor.verify.mockResolvedValue(false);
    const err = await complete().catch((e: unknown) => e);
    expect((err as DomainException).getStatus()).toBe(401);
    expect(throttle.recordFailure).toHaveBeenCalledWith(`twofa|${USER_ID}`);
    expect(auth.startSession).not.toHaveBeenCalled();
  });

  it('locks code guessing the same way passwords lock', async () => {
    throttle.assertNotLocked.mockRejectedValue(
      DomainException.tooManyRequests('Locked.'),
    );
    await expect(complete()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(twoFactor.verify).not.toHaveBeenCalled();
  });

  it('clears the strikes on success', async () => {
    await complete();
    expect(throttle.recordSuccess).toHaveBeenCalledWith(`twofa|${USER_ID}`);
  });

  it('refuses a tampered or expired challenge outright', async () => {
    tokens.verifyTwoFactorChallenge.mockRejectedValue(new Error('bad jwt'));
    const err = await complete().catch((e: unknown) => e);
    expect((err as DomainException).getStatus()).toBe(401);
    expect((err as DomainException).message).toMatch(/sign in again/i);
    expect(users.findProfile).not.toHaveBeenCalled();
  });

  it('refuses when the account vanished since the password step', async () => {
    users.findProfile.mockResolvedValue(null);
    await expect(complete()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses an account suspended between password and code', async () => {
    users.findProfile.mockResolvedValue(
      profile({ status: 'Suspended' }) as never,
    );
    const err = await complete().catch((e: unknown) => e);
    expect((err as DomainException).getStatus()).toBe(403);
    expect(auth.startSession).not.toHaveBeenCalled();
  });

  it("refuses a challenge whose account no longer matches the token's realm", async () => {
    users.findProfile.mockResolvedValue(
      profile({ organizationId: 999 }) as never,
    );
    await expect(complete()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
