import { DomainException } from '../../common/errors/domain.exception';
import type { AuthService } from '../auth/auth.service';
import type { SignupRepository } from '../auth-signup/auth-signup.repository';
import { AuthSocialRepository } from './auth-social.repository';
import { AuthSocialService } from './auth-social.service';
import type { SocialVerifierPort } from './ports/social-verifier.port';

const device = 'Chrome on Mac';
const ip = '203.0.113.9';
const ctx = { device, ip };

describe('AuthSocialService (US-ACC-06)', () => {
  let repo: jest.Mocked<AuthSocialRepository>;
  let verifier: jest.Mocked<SocialVerifierPort>;
  let auth: jest.Mocked<AuthService>;
  let signup: jest.Mocked<SignupRepository>;
  let service: AuthSocialService;

  const identity = {
    subject: 'google-sub-1',
    email: 'somchai@gmail.com',
    emailVerified: true,
    name: 'Somchai',
  };
  const found = {
    user: { id: 'u1', persona: 'admin', status: 'Active' },
    org: { id: 1, slug: 'acme' },
  };

  beforeEach(() => {
    repo = {
      findBySubject: jest.fn().mockResolvedValue(null),
      findUserByEmail: jest.fn().mockResolvedValue(null),
      link: jest.fn().mockResolvedValue(undefined),
      touchLastUsed: jest.fn().mockResolvedValue(undefined),
      loadLoginUser: jest.fn().mockResolvedValue(found),
    } as unknown as jest.Mocked<AuthSocialRepository>;
    verifier = {
      verify: jest.fn().mockResolvedValue(identity),
    };
    auth = {
      startSession: jest
        .fn()
        .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
    } as unknown as jest.Mocked<AuthService>;
    signup = {
      bootstrapWorkspace: jest.fn().mockResolvedValue({
        organizationId: 1,
        userId: 'new-1',
        slug: 'acme',
      }),
      uniqueSlug: jest.fn().mockResolvedValue('somchais-workspace'),
      activateEmail: jest.fn().mockResolvedValue({ orgSlug: 'acme' }),
    } as unknown as jest.Mocked<SignupRepository>;
    service = new AuthSocialService(repo, verifier, auth, signup);
  });

  describe('provider availability by audience', () => {
    it('an organizer may use Google', async () => {
      await expect(
        service.signIn({
          provider: 'google',
          idToken: 't',
          audience: 'admin',
          ...ctx,
        }),
      ).resolves.toBeDefined();
    });

    it('an organizer may NOT use Apple', async () => {
      await expect(
        service.signIn({
          provider: 'apple',
          idToken: 't',
          audience: 'admin',
          ...ctx,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(verifier.verify).not.toHaveBeenCalled();
    });

    it('an attendee may NOT use LinkedIn', async () => {
      await expect(
        service.signIn({
          provider: 'linkedin',
          idToken: 't',
          audience: 'attendee',
          orgSlug: 'acme',
          ...ctx,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  it('refuses a provider that has not verified the email', async () => {
    verifier.verify.mockResolvedValue({ ...identity, emailVerified: false });
    await expect(
      service.signIn({
        provider: 'google',
        idToken: 't',
        audience: 'admin',
        ...ctx,
      }),
    ).rejects.toBeInstanceOf(DomainException);
  });

  it('reports a cancelled consent screen without signing anyone in', async () => {
    await expect(
      service.signIn({
        provider: 'google',
        idToken: '',
        audience: 'admin',
        error: 'access_denied',
        ...ctx,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(auth.startSession).not.toHaveBeenCalled();
  });

  describe('new person', () => {
    it('creates an already-confirmed organizer account with a workspace', async () => {
      await service.signIn({
        provider: 'google',
        idToken: 't',
        audience: 'admin',
        ...ctx,
      });
      expect(signup.bootstrapWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ email: identity.email, passwordHash: null }),
      );
      // confirmed on arrival — no verification email needed
      expect(signup.activateEmail).toHaveBeenCalled();
      expect(repo.link).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          subject: identity.subject,
        }),
      );
    });
  });

  describe('existing password account with the same email', () => {
    it('links to it instead of creating a duplicate', async () => {
      repo.findUserByEmail.mockResolvedValue({
        userId: 'u1',
        organizationId: 1,
      });

      await service.signIn({
        provider: 'google',
        idToken: 't',
        audience: 'admin',
        ...ctx,
      });

      expect(signup.bootstrapWorkspace).not.toHaveBeenCalled();
      expect(repo.link).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1' }),
      );
    });
  });

  describe('returning person', () => {
    it('signs in through the existing link and records the use', async () => {
      repo.findBySubject.mockResolvedValue({ userId: 'u1', organizationId: 1 });
      await service.signIn({
        provider: 'google',
        idToken: 't',
        audience: 'admin',
        ...ctx,
      });
      expect(signup.bootstrapWorkspace).not.toHaveBeenCalled();
      expect(repo.touchLastUsed).toHaveBeenCalled();
      expect(auth.startSession).toHaveBeenCalled();
    });
  });

  describe('the two audiences never cross', () => {
    it('an attendee sign-in requires the workspace it belongs to', async () => {
      await expect(
        service.signIn({
          provider: 'google',
          idToken: 't',
          audience: 'attendee',
          ...ctx,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('refuses when the linked account is the other persona', async () => {
      repo.findBySubject.mockResolvedValue({ userId: 'u1', organizationId: 1 });
      repo.loadLoginUser.mockResolvedValue({
        user: { id: 'u1', persona: 'attendee', status: 'Active' },
        org: { id: 1, slug: 'acme' },
      } as never);
      await expect(
        service.signIn({
          provider: 'google',
          idToken: 't',
          audience: 'admin',
          ...ctx,
        }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(auth.startSession).not.toHaveBeenCalled();
    });
  });
});
