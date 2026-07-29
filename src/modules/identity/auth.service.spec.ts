import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import { AuthService, type LoginInput } from './auth.service';
import type {
  OrganizationRow,
  RefreshTokenClaims,
  UserRow,
} from './auth.types';
import { OutboxPort } from '../platform/outbox.port';
import { IdentityRepository } from './identity.repository';
import { PasswordService } from './password.service';
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
  let repo: jest.Mocked<IdentityRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let tokens: jest.Mocked<TokenService>;
  let outbox: jest.Mocked<OutboxPort>;
  let service: AuthService;

  beforeEach(() => {
    repo = {
      findLoginUser: jest.fn(),
      findValidSession: jest.fn(),
      findProfile: jest.fn(),
      createSession: jest.fn(),
      revokeSession: jest.fn(),
      touchLastActive: jest.fn(),
      recordAudit: jest.fn(),
      getPermissions: jest.fn().mockResolvedValue([]),
      findInvitedMembership: jest.fn(),
      activateInvite: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IdentityRepository>;
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
    service = new AuthService(repo, passwords, tokens, clock, outbox);
  });

  describe('login', () => {
    it('rejects an unknown user with 401', async () => {
      repo.findLoginUser.mockResolvedValue(null);
      await expect(service.login(input)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('rejects a wrong password with 401 and audits the failure', async () => {
      repo.findLoginUser.mockResolvedValue({ user: userRow(), org });
      passwords.verify.mockResolvedValue(false);
      await expect(service.login(input)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(repo.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'fail' }),
      );
    });

    it('rejects a non-active account with 403', async () => {
      repo.findLoginUser.mockResolvedValue({
        user: userRow({ status: 'Suspended' }),
        org,
      });
      passwords.verify.mockResolvedValue(true);
      await expect(service.login(input)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it('issues an access + refresh token pair on success', async () => {
      repo.findLoginUser.mockResolvedValue({ user: userRow(), org });
      passwords.verify.mockResolvedValue(true);
      repo.createSession.mockResolvedValue('sess-1');
      repo.getPermissions.mockResolvedValue(['setUsers']);

      const result = await service.login(input);

      expect(result.accessToken).toBe('access.jwt');
      expect(result.refreshToken).toBe('refresh.jwt');
      expect(result.expiresIn).toBe(900);
      expect(result.user.permissions).toEqual(['setUsers']);
      expect(tokens.signAccess).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sess-1', persona: 'admin' }),
      );
    });

    it('enqueues an identity.signed_in outbox event and does NOT audit the sign-in inline', async () => {
      repo.findLoginUser.mockResolvedValue({ user: userRow(), org });
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
