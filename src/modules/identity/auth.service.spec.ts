import { AuthService, type LoginInput } from './auth.service';
import type {
  OrganizationRow,
  RefreshTokenClaims,
  UserRow,
} from './auth.types';
import { IdentityRepository } from './identity.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

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
      accessTtlSeconds: 900,
      refreshTtlSeconds: 604800,
    } as unknown as jest.Mocked<TokenService>;
    service = new AuthService(repo, passwords, tokens);
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
      expect(repo.recordAudit).toHaveBeenCalledWith(
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
});
