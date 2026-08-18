import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import { AuthService, type LoginInput } from './auth.service';
import type {
  OrganizationRow,
  RefreshTokenClaims,
  UserRow,
} from './auth.types';
import { OutboxPort } from '../platform/outbox.port';
import { AuthRepository } from './auth.repository';
import type { PermissionsService } from '../access/permissions.service';
import type { UsersRepository } from '../users/users.repository';
import type { LoginThrottleService } from './login-throttle.service';
import type { SignupService } from '../auth-signup/auth-signup.service';
import { PasswordService } from '../auth-password/auth-password.service';
import { TokenService } from './token.service';

const clock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') };

const org = {
  id: 1,
  name: 'Acme',
  slug: 'acme',
  currency: 'THB',
  timezone: 'Asia/Bangkok',
  locale: 'en',
} as unknown as OrganizationRow;

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'u1',
    organizationId: 1,
    name: 'Admin',
    email: 'a@acme.test',
    persona: 'admin',
    status: 'Active',
    passwordHash: 'hashed',
    twoFactorEnabled: false,
    ...overrides,
  } as unknown as UserRow;
}

const input: LoginInput = {
  email: 'a@acme.test',
  password: 'pw',
  orgSlug: 'acme',
  device: 'jest',
  ip: null,
};

describe('AuthService', () => {
  let repo: jest.Mocked<AuthRepository>;
  let users: jest.Mocked<UsersRepository>;
  let permissions: jest.Mocked<PermissionsService>;
  let passwords: jest.Mocked<PasswordService>;
  let tokens: jest.Mocked<TokenService>;
  let outbox: jest.Mocked<OutboxPort>;
  let signup: jest.Mocked<SignupService>;
  let throttle: jest.Mocked<LoginThrottleService>;
  let service: AuthService;

  beforeEach(() => {
    repo = {
      findValidSession: jest.fn(),
      createSession: jest.fn(),
      revokeSession: jest.fn(),
      recordAudit: jest.fn(),
      findInvitedMembership: jest.fn(),
      activateInvite: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuthRepository>;
    users = {
      findLoginUser: jest.fn(),
      findProfile: jest.fn(),
      touchLastActive: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;
    permissions = {
      getFor: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PermissionsService>;
    passwords = {
      hash: jest.fn(),
      verify: jest.fn(),
    };
    tokens = {
      signAccess: jest.fn().mockResolvedValue('access.jwt'),
      signRefresh: jest.fn().mockResolvedValue('refresh.jwt'),
      verifyAccess: jest.fn(),
      verifyRefresh: jest.fn(),
      verifyInvite: jest.fn(),
      accessTtlSeconds: 900,
      refreshTtlSeconds: 604800,
    } as unknown as jest.Mocked<TokenService>;
    outbox = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    throttle = {
      assertNotLocked: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LoginThrottleService>;
    signup = {
      resendVerification: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SignupService>;
    service = new AuthService(
      repo,
      users,
      permissions,
      passwords,
      tokens,
      clock,
      outbox,
      throttle,
      signup,
    );
  });

  describe('login', () => {
    it('rejects an unknown user with 401', async () => {
      users.findLoginUser.mockResolvedValue(null);
      await expect(service.login(input)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('rejects a wrong password with 401 and audits the failure', async () => {
      users.findLoginUser.mockResolvedValue({ user: userRow(), org });
      passwords.verify.mockResolvedValue(false);
      await expect(service.login(input)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(repo.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'fail' }),
      );
    });

    it('rejects a suspended account with ACCOUNT_SUSPENDED (403)', async () => {
      users.findLoginUser.mockResolvedValue({
        user: userRow({ status: 'Suspended' }),
        org,
      });
      passwords.verify.mockResolvedValue(true);
      await expect(service.login(input)).rejects.toMatchObject({
        code: 'ACCOUNT_SUSPENDED',
      });
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('refuses an unconfirmed account and re-sends a fresh confirmation email', async () => {
      users.findLoginUser.mockResolvedValue({
        user: userRow({ status: 'Unconfirmed' }),
        org,
      });
      passwords.verify.mockResolvedValue(true);
      await expect(service.login(input)).rejects.toMatchObject({
        code: 'EMAIL_NOT_CONFIRMED',
      });
      expect(signup.resendVerification).toHaveBeenCalledTimes(1);
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    /**
     * `Invited` and `Unconfirmed` both mean "cannot sign in yet" and are NOT
     * the same event. An invited teammate never chose to sign up and has no
     * confirmation link owed to them — they have an invitation to accept, and
     * sending them a "confirm your email" message would point at the wrong
     * thing entirely.
     */
    it('refuses an invited teammate WITHOUT sending a confirmation email', async () => {
      users.findLoginUser.mockResolvedValue({
        user: userRow({ status: 'Invited' }),
        org,
      });
      passwords.verify.mockResolvedValue(true);
      await expect(service.login(input)).rejects.toMatchObject({
        code: 'EMAIL_NOT_CONFIRMED',
      });
      expect(signup.resendVerification).not.toHaveBeenCalled();
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('issues an access + refresh token pair on success', async () => {
      users.findLoginUser.mockResolvedValue({ user: userRow(), org });
      passwords.verify.mockResolvedValue(true);
      repo.createSession.mockResolvedValue('sess-1');
      permissions.getFor.mockResolvedValue(['setUsers']);

      const result = await service.login(input);

      // No challenge here — 2FA is off for this account.
      if ('twoFactorRequired' in result)
        throw new Error('unexpected challenge');
      expect(result.accessToken).toBe('access.jwt');
      expect(result.refreshToken).toBe('refresh.jwt');
      expect(result.expiresIn).toBe(900);
      expect(result.user.permissions).toEqual(['setUsers']);
      expect(tokens.signAccess).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sess-1', persona: 'admin' }),
      );
    });

    it('enqueues an identity.signed_in outbox event and does NOT audit the sign-in inline', async () => {
      users.findLoginUser.mockResolvedValue({ user: userRow(), org });
      passwords.verify.mockResolvedValue(true);
      repo.createSession.mockResolvedValue('sess-1');

      await service.login(input);

      const [event] = outbox.enqueue.mock.calls[0];
      expect(event.routingKey).toBe('identity.signed_in');
      expect(event.organizationId).toBe(1);
      expect(event.aggregateId).toBe('u1');
      expect(event.payload).toMatchObject({ userId: 'u1', device: 'jest' });
      expect(repo.recordAudit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'signin' }),
      );
    });
  });

  // US-ACC-05: with 2FA on, a correct password earns a challenge, not a session.
  describe('login — the two-factor challenge', () => {
    beforeEach(() => {
      users.findLoginUser.mockResolvedValue({
        user: userRow({ twoFactorEnabled: true }),
        org,
      });
      passwords.verify.mockResolvedValue(true);
      tokens.signTwoFactorChallenge = jest
        .fn()
        .mockResolvedValue('challenge.jwt');
      Object.defineProperty(tokens, 'twoFactorChallengeTtlSeconds', {
        value: 300,
      });
    });

    it('answers with a challenge and opens NO session', async () => {
      const result = await service.login(input);
      expect(result).toEqual({
        twoFactorRequired: true,
        challengeToken: 'challenge.jwt',
        expiresIn: 300,
      });
      expect(repo.createSession).not.toHaveBeenCalled();
      expect(tokens.signAccess).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('carries remember-me into the challenge for the second step', async () => {
      await service.login({ ...input, rememberMe: true });
      expect(tokens.signTwoFactorChallenge).toHaveBeenCalledWith(
        expect.objectContaining({ rememberMe: true }),
      );
    });

    it('still refuses a wrong password before any challenge exists', async () => {
      passwords.verify.mockResolvedValue(false);
      await expect(service.login(input)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(tokens.signTwoFactorChallenge).not.toHaveBeenCalled();
    });
  });

  // US-DISC-08: attendees live in ONE platform workspace; organizers name theirs.
  describe('login — resolving the workspace by persona', () => {
    beforeEach(() => {
      users.findLoginUser.mockResolvedValue({
        user: userRow({ persona: 'attendee' }),
        org,
      });
      passwords.verify.mockResolvedValue(true);
    });

    it('signs an attendee into the platform workspace with no orgSlug at all', async () => {
      await service.login({
        ...input,
        orgSlug: undefined,
        persona: 'attendee',
      });
      expect(users.findLoginUser).toHaveBeenCalledWith(
        'eventa',
        input.email,
        'attendee',
      );
    });

    it('refuses an attendee login that names a workspace', async () => {
      await expect(
        service.login({ ...input, orgSlug: 'acme', persona: 'attendee' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(users.findLoginUser).not.toHaveBeenCalled();
    });

    it('still requires the workspace slug for an organizer login', async () => {
      await expect(
        service.login({ ...input, orgSlug: undefined }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(users.findLoginUser).not.toHaveBeenCalled();
    });

    it('throttles attendee attempts against the platform realm', async () => {
      users.findLoginUser.mockResolvedValue(null);
      await service
        .login({ ...input, orgSlug: undefined, persona: 'attendee' })
        .catch(() => undefined);
      expect(throttle.assertNotLocked).toHaveBeenCalledWith(
        `eventa|attendee|${input.email}`,
      );
    });
  });

  describe('refresh', () => {
    const claims: RefreshTokenClaims = {
      sub: 'u1',
      org: 1,
      sid: 's1',
      persona: 'admin',
      typ: 'refresh',
    };

    it('mints a new access token when the session is live', async () => {
      tokens.verifyRefresh.mockResolvedValue(claims);
      repo.findValidSession.mockResolvedValue({
        userId: 'u1',
        organizationId: 1,
      });
      tokens.signAccess.mockResolvedValue('new.access');

      const result = await service.refresh('refresh.jwt');
      expect(result.accessToken).toBe('new.access');
    });

    it('rejects when the session was revoked', async () => {
      tokens.verifyRefresh.mockResolvedValue(claims);
      repo.findValidSession.mockResolvedValue(null);
      await expect(service.refresh('refresh.jwt')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('rejects an invalid refresh token', async () => {
      tokens.verifyRefresh.mockRejectedValue(new Error('bad signature'));
      await expect(service.refresh('nope')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  describe('acceptInvite', () => {
    const inviteClaims = { sub: 'u9', org: 1, mid: 11, typ: 'invite' as const };

    it('rejects an invalid/expired invite token with 401', async () => {
      tokens.verifyInvite.mockRejectedValue(new Error('bad signature'));
      await expect(service.acceptInvite('nope', 'pw')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(repo.activateInvite).not.toHaveBeenCalled();
    });

    it('rejects when the membership is no longer Invited (already used)', async () => {
      tokens.verifyInvite.mockResolvedValue(inviteClaims);
      repo.findInvitedMembership.mockResolvedValue(null);
      await expect(
        service.acceptInvite('invite.jwt', 'pw'),
      ).rejects.toBeInstanceOf(DomainException);
      expect(repo.activateInvite).not.toHaveBeenCalled();
    });

    it('hashes the password and activates the member', async () => {
      tokens.verifyInvite.mockResolvedValue(inviteClaims);
      repo.findInvitedMembership.mockResolvedValue({
        userId: 'u9',
        organizationId: 1,
        email: 'new@acme.test',
      });
      passwords.hash.mockResolvedValue('hashed-pw');

      const result = await service.acceptInvite('invite.jwt', 'secret-pw');

      expect(passwords.hash).toHaveBeenCalledWith('secret-pw');
      expect(repo.activateInvite).toHaveBeenCalledWith('u9', 11, 'hashed-pw');
      expect(result).toMatchObject({
        email: 'new@acme.test',
        status: 'Active',
      });
    });
  });
});
