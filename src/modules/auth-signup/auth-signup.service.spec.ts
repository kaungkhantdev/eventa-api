import type { ConfigService } from '@nestjs/config';
import type { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.validation';
import type { OutboxPort } from '../platform/outbox.port';
import type { PasswordService } from '../auth-password/auth-password.service';
import { SignupService } from './auth-signup.service';
import type { SignupRepository } from './auth-signup.repository';
import type { TokenService } from '../auth/token.service';
import { IDENTITY_EMAIL_VERIFICATION_REQUESTED } from './events/email-verification-requested.event';

const NOW = new Date('2026-07-31T00:00:00.000Z');
const newAccount = {
  name: 'Somchai',
  email: 'owner@acme.co.th',
  password: 'strongpass1',
};

describe('SignupService', () => {
  let repo: jest.Mocked<SignupRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let tokens: jest.Mocked<TokenService>;
  let outbox: jest.Mocked<OutboxPort>;
  let service: SignupService;

  beforeEach(() => {
    repo = {
      organizerEmailExists: jest.fn().mockResolvedValue(false),
      uniqueSlug: jest.fn().mockResolvedValue('acme-events'),
      bootstrapWorkspace: jest.fn().mockResolvedValue({
        organizationId: 7,
        userId: 'u1',
        slug: 'acme-events',
      }),
      activateEmail: jest
        .fn()
        .mockResolvedValue({ orgSlug: 'acme-events', persona: 'admin' }),
      attendeeEmailExists: jest.fn().mockResolvedValue(false),
      createAttendeeAccount: jest
        .fn()
        .mockResolvedValue({ organizationId: 1, userId: 'a1' }),
    } as unknown as jest.Mocked<SignupRepository>;
    passwords = {
      hash: jest.fn().mockResolvedValue('HASH'),
    } as unknown as jest.Mocked<PasswordService>;
    tokens = {
      signEmailVerification: jest.fn().mockResolvedValue('VTOKEN'),
      verifyEmailVerification: jest
        .fn()
        .mockResolvedValue({ sub: 'u1', org: 7 }),
    } as unknown as jest.Mocked<TokenService>;
    outbox = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const clock: Clock = { now: () => NOW };
    const config = {
      getOrThrow: jest.fn().mockReturnValue('https://web.test'),
    } as unknown as ConfigService<Env, true>;
    service = new SignupService(repo, passwords, tokens, outbox, clock, config);
  });

  describe('register', () => {
    it('bootstraps a workspace and enqueues a verification email for a new email', async () => {
      const res = await service.register(newAccount);

      expect(res.message).toMatch(/check your inbox/i);
      expect(passwords.hash).toHaveBeenCalledWith('strongpass1');
      expect(repo.bootstrapWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'owner@acme.co.th',
          passwordHash: 'HASH',
          slug: 'acme-events',
        }),
      );
      const event = outbox.enqueue.mock.calls[0][0];
      expect(event.routingKey).toBe(IDENTITY_EMAIL_VERIFICATION_REQUESTED);
      expect(event.payload.verifyUrl).toBe(
        'https://web.test/verify-email?token=VTOKEN',
      );
    });

    it('defaults the workspace name from the person’s name', async () => {
      await service.register(newAccount);
      expect(repo.uniqueSlug).toHaveBeenCalled();
      expect(repo.bootstrapWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ organizationName: 'Somchai’s Workspace' }),
      );
    });

    it('returns the same neutral message for an already-registered email — no bootstrap, no email', async () => {
      repo.organizerEmailExists.mockResolvedValue(true);

      const res = await service.register(newAccount);

      expect(res.message).toMatch(/check your inbox/i);
      expect(repo.bootstrapWorkspace).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });
  });

  /**
   * US-DISC-08. The same endpoint, told which realm it is for. A buyer signing
   * up from their own order is not an organizer: they get one `attendee` user
   * in the platform organization, and no workspace is created for them.
   */
  describe('register — persona: attendee', () => {
    const attendee = {
      name: 'Somchai',
      email: 'buyer@example.test',
      password: 'strongpass1',
      persona: 'attendee' as const,
    };

    it('creates the account in the platform org and enqueues the confirmation email', async () => {
      const res = await service.register(attendee);

      expect(res.message).toMatch(/check your inbox/i);
      expect(passwords.hash).toHaveBeenCalledWith('strongpass1');
      expect(repo.createAttendeeAccount).toHaveBeenCalledWith({
        name: 'Somchai',
        email: 'buyer@example.test',
        passwordHash: 'HASH',
      });
      const event = outbox.enqueue.mock.calls[0][0];
      expect(event.routingKey).toBe(IDENTITY_EMAIL_VERIFICATION_REQUESTED);
      expect(event.payload.verifyUrl).toBe(
        'https://web.test/verify-email?token=VTOKEN',
      );
    });

    /**
     * The defect this branch exists to remove: the portal's "Create account"
     * posted here and got an organization. An attendee owns no workspace.
     */
    it('creates no workspace — an attendee owns no organization', async () => {
      await service.register(attendee);

      expect(repo.bootstrapWorkspace).not.toHaveBeenCalled();
      expect(repo.uniqueSlug).not.toHaveBeenCalled();
    });

    it('returns the same neutral message for an address that already has one — no account, no email', async () => {
      repo.attendeeEmailExists.mockResolvedValue(true);

      const res = await service.register(attendee);

      expect(res.message).toMatch(/check your inbox/i);
      expect(repo.createAttendeeAccount).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });

    /**
     * The realms are separate: one person may run events AND buy a ticket, and
     * `users` is unique on (organization_id, email, persona). An organizer
     * account on the same address must not block the attendee one.
     */
    it('is not blocked by an organizer account on the same address', async () => {
      repo.organizerEmailExists.mockResolvedValue(true);

      await service.register(attendee);

      expect(repo.createAttendeeAccount).toHaveBeenCalled();
    });

    /**
     * Refused rather than ignored, matching attendee sign-in: a client that
     * sends a workspace for an attendee is confused, and should fail loudly.
     */
    it('refuses a workspace name — an attendee has none to name (422)', async () => {
      await expect(
        service.register({ ...attendee, organizationName: 'Acme Events' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.createAttendeeAccount).not.toHaveBeenCalled();
    });

    it('surfaces a missing platform organization rather than reporting success', async () => {
      repo.createAttendeeAccount.mockResolvedValue(null);

      await expect(service.register(attendee)).rejects.toBeInstanceOf(
        DomainException,
      );
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('activates the account and returns the workspace slug', async () => {
      const res = await service.verifyEmail('VTOKEN');
      expect(tokens.verifyEmailVerification).toHaveBeenCalledWith('VTOKEN');
      expect(repo.activateEmail).toHaveBeenCalledWith('u1', 7);
      expect(res).toEqual({
        verified: true,
        orgSlug: 'acme-events',
        persona: 'admin',
      });
    });

    /**
     * The confirmation page has to know which sign-in to offer. An attendee's
     * slug is the platform org's — never something to type into a workspace
     * field, because attendee sign-in refuses an orgSlug outright.
     */
    it('reports the persona, so the page sends an attendee to the portal login', async () => {
      repo.activateEmail.mockResolvedValue({
        orgSlug: 'eventa',
        persona: 'attendee',
      });

      expect(await service.verifyEmail('VTOKEN')).toEqual({
        verified: true,
        orgSlug: 'eventa',
        persona: 'attendee',
      });
    });

    it('rejects an invalid/expired token (422)', async () => {
      tokens.verifyEmailVerification.mockRejectedValue(new Error('bad token'));
      await expect(service.verifyEmail('nope')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(repo.activateEmail).not.toHaveBeenCalled();
    });

    it('rejects a token whose account no longer exists (422)', async () => {
      repo.activateEmail.mockResolvedValue(null);
      await expect(service.verifyEmail('VTOKEN')).rejects.toBeInstanceOf(
        DomainException,
      );
    });
  });
});
