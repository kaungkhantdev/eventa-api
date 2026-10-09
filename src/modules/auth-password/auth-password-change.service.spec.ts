import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { PasswordChangeService } from './auth-password-change.service';
import type { PasswordRepository } from './auth-password.repository';
import type { PasswordService } from './auth-password.service';

const actor: AuthContext = {
  userId: 'u1',
  organizationId: 7,
  sessionId: 'sess-A',
  persona: 'admin',
};

const NOW = new Date('2026-03-04T05:06:07.000Z');

describe('PasswordChangeService', () => {
  let repo: jest.Mocked<PasswordRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let clock: Clock;
  let service: PasswordChangeService;

  beforeEach(() => {
    repo = {
      currentHash: jest.fn().mockResolvedValue('CURRENT'),
      findChangeAccount: jest.fn().mockResolvedValue({
        passwordHash: 'CURRENT',
        name: 'Dao Suwan',
        email: 'dao@change.test',
      }),
      setPassword: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PasswordRepository>;
    passwords = {
      hash: jest.fn().mockResolvedValue('NEWHASH'),
      verify: jest.fn(),
    };
    clock = { now: () => NOW };
    service = new PasswordChangeService(repo, passwords, clock);
  });

  it('changes the password and keeps only the current session', async () => {
    passwords.verify
      .mockResolvedValueOnce(true) // current password matches
      .mockResolvedValueOnce(false); // new differs from current

    const res = await service.change(actor, 'oldpass1word', 'newpass2word');

    expect(passwords.hash).toHaveBeenCalledWith('newpass2word');
    expect(repo.setPassword).toHaveBeenCalledWith(
      7,
      'u1',
      'NEWHASH',
      'sess-A',
      expect.any(Function),
    );
    expect(res.message).toMatch(/changed/i);
  });

  /**
   * The notice is handed to the repository as a builder, not enqueued here: the
   * repository owns the transaction the password write happens in, and the row
   * has to live or die with it (US-DISC-12 AC4). A service that enqueued it
   * itself would be the second write the outbox exists to prevent.
   */
  it('hands the write a confirmation notice carrying the devices signed out', async () => {
    passwords.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await service.change(actor, 'oldpass1word', 'newpass2word');

    const buildNotice = repo.setPassword.mock.calls[0][4];
    expect(buildNotice?.(2)).toEqual({
      organizationId: 7,
      aggregateType: 'user',
      aggregateId: 'u1',
      routingKey: 'identity.password_changed',
      payload: {
        version: 1,
        organizationId: 7,
        userId: 'u1',
        name: 'Dao Suwan',
        email: 'dao@change.test',
        otherSessionsSignedOut: 2,
        occurredAt: NOW.toISOString(),
      },
    });
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
