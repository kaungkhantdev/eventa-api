import { generateTotp, generateTotpSecret } from '../../common/crypto/totp';
import { DomainException } from '../../common/errors/domain.exception';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import type { Clock } from '../../common/time/clock';
import type { OutboxPort } from '../platform/outbox.port';
import type { ProfileService } from '../users/profile.service';
import { AuthTwoFactorRepository } from './auth-two-factor.repository';
import { AuthTwoFactorService } from './auth-two-factor.service';

const auth = { organizationId: 1, userId: 'u1', sessionId: 's1' };
const NOW = new Date('2026-08-01T00:00:00Z');
const KEY = Buffer.alloc(32, 7).toString('base64');

describe('AuthTwoFactorService (US-SET-03 / US-ACC-07)', () => {
  let repo: jest.Mocked<AuthTwoFactorRepository>;
  let outbox: jest.Mocked<OutboxPort>;
  let service: AuthTwoFactorService;
  let cipher: SecretCipher;
  let secret: string;

  const enrolment = (confirmed: boolean) => ({
    id: 10,
    userId: 'u1',
    organizationId: 1,
    secretEncrypted: cipher.encrypt(secret),
    confirmedAt: confirmed ? NOW : null,
  });

  beforeEach(() => {
    cipher = new SecretCipher({ getOrThrow: () => KEY } as never);
    secret = generateTotpSecret();
    repo = {
      find: jest.fn().mockResolvedValue(enrolment(false)),
      upsertPending: jest.fn().mockResolvedValue(enrolment(false)),
      confirm: jest.fn().mockResolvedValue(undefined),
      disable: jest.fn().mockResolvedValue(undefined),
      replaceRecoveryCodes: jest.fn().mockResolvedValue(undefined),
      consumeRecoveryCode: jest.fn().mockResolvedValue(false),
      countUnusedCodes: jest.fn().mockResolvedValue(8),
    } as unknown as jest.Mocked<AuthTwoFactorRepository>;
    outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const profile = {
      get: jest
        .fn()
        .mockResolvedValue({ email: 'a@acme.test', name: 'Somchai' }),
    } as unknown as ProfileService;
    const clock: Clock = { now: () => NOW };
    service = new AuthTwoFactorService(repo, cipher, profile, outbox, clock);
  });

  const validCode = () => generateTotp(secret);

  describe('start', () => {
    it('mints a seed and an otpauth URI for the QR', async () => {
      repo.find.mockResolvedValue(null);
      const res = await service.start(auth);
      expect(res.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(res.secret).toBeTruthy();
      expect(repo.upsertPending).toHaveBeenCalled();
    });

    it('refuses to re-enrol while it is already on', async () => {
      repo.find.mockResolvedValue(enrolment(true) as never);
      await expect(service.start(auth)).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('confirm', () => {
    it('turns it on and returns exactly 8 one-time recovery codes', async () => {
      const codes = await service.confirm(auth, validCode());
      expect(codes).toHaveLength(8);
      expect(codes[0]).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
      expect(repo.confirm).toHaveBeenCalled();
      // only HASHES are persisted — never the codes themselves
      const [, , , hashes] = repo.confirm.mock.calls[0];
      expect(hashes).toHaveLength(8);
      for (const code of codes) expect(hashes).not.toContain(code);
    });

    it('leaves two-factor OFF when the code is wrong', async () => {
      await expect(service.confirm(auth, '000000')).rejects.toBeInstanceOf(
        DomainException,
      );
      expect(repo.confirm).not.toHaveBeenCalled();
    });
  });

  describe('disable', () => {
    beforeEach(() => repo.find.mockResolvedValue(enrolment(true) as never));

    it('requires a valid code, then clears it and emails the member', async () => {
      await service.disable(auth, validCode());
      expect(repo.disable).toHaveBeenCalledWith(1, 'u1', 10);
      const [event] = outbox.enqueue.mock.calls[0];
      expect(event.routingKey).toBe('identity.two_factor_disabled');
    });

    it('refuses a wrong code and stays on', async () => {
      await expect(service.disable(auth, '000000')).rejects.toBeInstanceOf(
        DomainException,
      );
      expect(repo.disable).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('accepts a recovery code as the re-confirmation', async () => {
      repo.consumeRecoveryCode.mockResolvedValue(true);
      await service.disable(auth, 'ABCDE-12345');
      expect(repo.disable).toHaveBeenCalled();
    });
  });

  describe('regenerateRecoveryCodes', () => {
    beforeEach(() => repo.find.mockResolvedValue(enrolment(true) as never));

    it('issues a fresh set of 8, replacing every old code', async () => {
      const codes = await service.regenerateRecoveryCodes(auth, validCode());
      expect(codes).toHaveLength(8);
      expect(repo.replaceRecoveryCodes).toHaveBeenCalledWith(
        1,
        10,
        expect.arrayContaining([expect.any(String)]),
      );
    });
  });

  describe('verify (used at sign-in)', () => {
    beforeEach(() => repo.find.mockResolvedValue(enrolment(true) as never));

    it('accepts the current TOTP', async () => {
      expect(await service.verify(1, 'u1', validCode())).toBe(true);
    });

    it('falls back to spending a recovery code', async () => {
      repo.consumeRecoveryCode.mockResolvedValue(true);
      expect(await service.verify(1, 'u1', 'ABCDE-12345')).toBe(true);
    });

    it('rejects when neither matches', async () => {
      expect(await service.verify(1, 'u1', '000000')).toBe(false);
    });

    it('is false when two-factor was never confirmed', async () => {
      repo.find.mockResolvedValue(enrolment(false) as never);
      expect(await service.verify(1, 'u1', validCode())).toBe(false);
    });
  });

  it('encrypts the seed at rest and round-trips it', () => {
    const blob = cipher.encrypt(secret);
    expect(blob.toString('utf8')).not.toContain(secret);
    expect(cipher.decrypt(blob)).toBe(secret);
  });
});
