import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from './auth.types';
import { PasswordChangeService } from './password-change.service';
import type { PasswordRepository } from './password.repository';
import type { PasswordService } from './password.service';

const actor: AuthContext = {
  userId: 'u1',
  organizationId: 7,
  sessionId: 'sess-A',
  persona: 'admin',
};

describe('PasswordChangeService', () => {
  let repo: jest.Mocked<PasswordRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let service: PasswordChangeService;

  beforeEach(() => {
    repo = {
      currentHash: jest.fn().mockResolvedValue('CURRENT'),
      setPassword: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PasswordRepository>;
    passwords = {
      hash: jest.fn().mockResolvedValue('NEWHASH'),
      verify: jest.fn(),
    };
    service = new PasswordChangeService(repo, passwords);
  });

  it('changes the password and keeps only the current session', async () => {
    passwords.verify
      .mockResolvedValueOnce(true) // current password matches
      .mockResolvedValueOnce(false); // new differs from current

    const res = await service.change(actor, 'oldpass1word', 'newpass2word');

    expect(passwords.hash).toHaveBeenCalledWith('newpass2word');
    expect(repo.setPassword).toHaveBeenCalledWith(7, 'u1', 'NEWHASH', 'sess-A');
    expect(res.message).toMatch(/changed/i);
  });

  it('refuses (403) and signs nobody out when the current password is wrong', async () => {
    passwords.verify.mockResolvedValueOnce(false);
    let status: number | undefined;
    try {
      await service.change(actor, 'wrong', 'newpass2word');
    } catch (err) {
      status = (err as DomainException).getStatus();
    }
    expect(status).toBe(HttpStatus.FORBIDDEN);
    expect(repo.setPassword).not.toHaveBeenCalled();
  });

  it('rejects (422) a new password equal to the current one', async () => {
    passwords.verify
      .mockResolvedValueOnce(true) // current matches
      .mockResolvedValueOnce(true); // new equals current
    await expect(
      service.change(actor, 'oldpass1word', 'oldpass1word'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repo.setPassword).not.toHaveBeenCalled();
  });
});
