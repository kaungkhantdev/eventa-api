import { AuthService, type LoginInput } from './auth.service';
import type { OrganizationRow, UserRow } from './auth.types';
import { IdentityRepository } from './identity.repository';
import { PasswordService } from './password.service';

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

describe('AuthService.login', () => {
  let repo: jest.Mocked<IdentityRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let service: AuthService;

  beforeEach(() => {
    repo = {
      findLoginUser: jest.fn(),
      findValidSession: jest.fn(),
      createSession: jest.fn(),
      revokeSession: jest.fn(),
      touchLastActive: jest.fn(),
      recordAudit: jest.fn(),
      getPermissions: jest.fn(),
    } as unknown as jest.Mocked<IdentityRepository>;
    passwords = {
      hash: jest.fn(),
      verify: jest.fn(),
    };
    service = new AuthService(repo, passwords);
  });

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

  it('issues a session and returns the user + permissions on success', async () => {
    repo.findLoginUser.mockResolvedValue({ user: userRow(), org });
    passwords.verify.mockResolvedValue(true);
    repo.createSession.mockResolvedValue('sess-1');
    repo.getPermissions.mockResolvedValue(['setUsers']);

    const result = await service.login(input);

    expect(result.sessionId).toBe('sess-1');
    expect(result.user.email).toBe('a@acme.test');
    expect(result.user.permissions).toEqual(['setUsers']);
    expect(repo.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'signin' }),
    );
  });
});
