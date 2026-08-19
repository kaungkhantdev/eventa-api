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
import { IDENTITY_PASSWORD_RESET_REQUESTED } from './events/password-reset-requested.event';

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
    service = new PasswordResetService(
      repo,
      passwords,
      tokens,
      outbox,
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

    it('returns the same neutral message and sends nothing for an unknown email', async () => {
      repo.findByEmailPersona.mockResolvedValue(null);
      const res = await service.forgot('ghost@acme.co.th');
      expect(res.message).toMatch(/on its way/i);
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
