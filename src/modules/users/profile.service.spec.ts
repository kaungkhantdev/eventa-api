import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { OutboxPort } from '../platform/outbox.port';
import type { TokenService } from '../auth/token.service';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './profile.repository';
import type { ProfileRow } from './users.types';

const orgId = 1;
const userId = 'u1';
const NOW = new Date('2026-08-01T00:00:00Z');
const auth = { organizationId: orgId, userId, sessionId: 's1' };

function profileRow(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: userId,
    organizationId: orgId,
    name: 'Somchai',
    email: 'somchai@acme.test',
    pendingEmail: null,
    phone: null,
    timezone: null,
    locale: null,
    avatarUrl: null,
    ...overrides,
  };
}

describe('ProfileService (US-SET-01)', () => {
  let repo: jest.Mocked<ProfileRepository>;
  let tokens: jest.Mocked<TokenService>;
  let outbox: jest.Mocked<OutboxPort>;
  let service: ProfileService;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue(profileRow()),
      update: jest
        .fn()
        .mockImplementation((_o, _u, values: object) =>
          Promise.resolve(profileRow(values as Partial<ProfileRow>)),
        ),
      emailTaken: jest.fn().mockResolvedValue(false),
      promoteEmail: jest.fn().mockResolvedValue(profileRow()),
    } as unknown as jest.Mocked<ProfileRepository>;
    tokens = {
      signEmailChange: jest.fn().mockResolvedValue('change.jwt'),
      verifyEmailChange: jest.fn(),
    } as unknown as jest.Mocked<TokenService>;
    outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const clock: Clock = { now: () => NOW };
    service = new ProfileService(repo, tokens, outbox, clock, {
      getOrThrow: () => 'https://web.test',
    } as never);
  });

  describe('get', () => {
    it('returns the fields the profile page edits', async () => {
      const res = await service.get(auth);
      expect(res).toMatchObject({
        name: 'Somchai',
        email: 'somchai@acme.test',
        emailVerified: true,
      });
    });
  });

  describe('update', () => {
    it('saves the name and phone', async () => {
      const res = await service.update(auth, {
        name: 'Somchai S.',
        phone: '+66812345678',
      });
      expect(repo.update).toHaveBeenCalledWith(
        orgId,
        userId,
        expect.objectContaining({ name: 'Somchai S.', phone: '+66812345678' }),
      );
      expect(res.name).toBe('Somchai S.');
    });

    it('keeps the timezone and language the console renders in', async () => {
      await service.update(auth, { timezone: 'Asia/Bangkok', locale: 'th' });
      expect(repo.update).toHaveBeenCalledWith(
        orgId,
        userId,
        expect.objectContaining({ timezone: 'Asia/Bangkok', locale: 'th' }),
      );
    });

    it('only writes the keys provided, so a partial save keeps the rest', async () => {
      await service.update(auth, { phone: '+66800000000' });
      const [, , values] = repo.update.mock.calls[0];
      expect(Object.keys(values)).toEqual(['phone']);
    });

    it('rejects an unusable timezone', async () => {
      await expect(
        service.update(auth, { timezone: 'Mars/Olympus' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('requestEmailChange', () => {
    it('keeps the current email working, marks it unverified and mails the new one', async () => {
      const res = await service.requestEmailChange(auth, 'new@acme.test');

      // stored as PENDING — the sign-in email is untouched
      expect(repo.update).toHaveBeenCalledWith(
        orgId,
        userId,
        expect.objectContaining({ pendingEmail: 'new@acme.test' }),
      );
      const [, , values] = repo.update.mock.calls[0];
      expect(values).not.toHaveProperty('email');

      // and the confirmation link went to the NEW address
      const [event] = outbox.enqueue.mock.calls[0];
      expect(event.payload).toMatchObject({ email: 'new@acme.test' });
      expect(res.emailVerified).toBe(false);
    });

    it('refuses an address already used in the workspace', async () => {
      repo.emailTaken.mockResolvedValue(true);
      await expect(
        service.requestEmailChange(auth, 'taken@acme.test'),
      ).rejects.toBeInstanceOf(DomainException);
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    it('refuses an address that is already my own', async () => {
      await expect(
        service.requestEmailChange(auth, 'somchai@acme.test'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('confirmEmailChange', () => {
    it('promotes the pending address once the link is opened', async () => {
      tokens.verifyEmailChange.mockResolvedValue({
        sub: userId,
        org: orgId,
        email: 'new@acme.test',
        typ: 'change_email',
      });
      repo.promoteEmail.mockResolvedValue(
        profileRow({ email: 'new@acme.test', pendingEmail: null }),
      );

      const res = await service.confirmEmailChange('change.jwt');

      expect(repo.promoteEmail).toHaveBeenCalledWith(
        orgId,
        userId,
        'new@acme.test',
      );
      expect(res.email).toBe('new@acme.test');
      expect(res.emailVerified).toBe(true);
    });

    it('rejects a tampered or expired link', async () => {
      tokens.verifyEmailChange.mockRejectedValue(new Error('bad signature'));
      await expect(service.confirmEmailChange('nope')).rejects.toBeInstanceOf(
        DomainException,
      );
      expect(repo.promoteEmail).not.toHaveBeenCalled();
    });
  });
});
