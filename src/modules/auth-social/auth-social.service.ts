import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { slugify } from '../../common/util/slugify';
import { SignupRepository } from '../auth-signup/auth-signup.repository';
import { AuthSocialRepository } from './auth-social.repository';
import {
  AuthService,
  type LoginResult,
  type LoginUser,
} from '../auth/auth.service';
import type { Persona } from '../auth/auth.types';
import {
  SocialVerifierPort,
  type SocialProvider,
  type VerifiedIdentity,
} from './ports/social-verifier.port';

/**
 * Which providers each audience may use. An organizer signs in with a work
 * identity; an attendee with a consumer one — the lists deliberately differ.
 */
const PROVIDERS_BY_AUDIENCE: Record<Persona, readonly SocialProvider[]> = {
  admin: ['google', 'linkedin'],
  attendee: ['google', 'apple'],
};

/** The provider returns this when the person closes the consent screen. */
const CONSENT_DENIED = 'access_denied';

export interface SocialSignInInput {
  provider: SocialProvider;
  idToken: string;
  /** Which console the flow was started from — never inferred from the token. */
  audience: Persona;
  /** Required for an attendee: which workspace's portal they are entering. */
  orgSlug?: string;
  /** Set when the provider reported a cancellation rather than a token. */
  error?: string;
  device: string;
  ip: string | null;
  rememberMe?: boolean;
}

/**
 * Sign in (or sign up) with Google, Apple or LinkedIn (US-ACC-06).
 *
 * The browser completes the provider's flow and posts us the resulting id token;
 * we verify it and never handle a password or a client secret. The audience comes
 * from the endpoint the flow started at, so an organizer sign-in can only ever
 * create or link an ORGANIZER account and an attendee one only an attendee —
 * the two realms never cross (US-ACC-11).
 */
@Injectable()
export class AuthSocialService {
  constructor(
    private readonly repo: AuthSocialRepository,
    private readonly verifier: SocialVerifierPort,
    private readonly auth: AuthService,
    private readonly signup: SignupRepository,
  ) {}

  async signIn(input: SocialSignInInput): Promise<LoginResult> {
    this.assertNotCancelled(input);
    this.assertProviderAllowed(input.provider, input.audience);
    if (input.audience === 'attendee' && !input.orgSlug) {
      throw DomainException.validation(
        'An attendee sign-in must say which workspace it is for.',
      );
    }
    const identity = await this.verify(input);
    const userId = await this.resolveAccount(identity, input);
    const found = await this.loadEligible(userId, input.audience);
    return this.auth.startSession(found, {
      device: input.device,
      ip: input.ip,
      rememberMe: input.rememberMe,
    });
  }

  /** Find the existing link, else the existing account, else create one. */
  private async resolveAccount(
    identity: VerifiedIdentity,
    input: SocialSignInInput,
  ): Promise<string> {
    const linked = await this.repo.findBySubject(
      input.provider,
      identity.subject,
    );
    if (linked) {
      await this.repo.touchLastUsed(input.provider, identity.subject);
      return linked.userId;
    }
    const existing = await this.repo.findUserByEmail(
      identity.email,
      input.audience,
      input.orgSlug,
    );
    const account = existing ?? (await this.createAccount(identity, input));
    await this.repo.link({
      organizationId: account.organizationId,
      userId: account.userId,
      provider: input.provider,
      subject: identity.subject,
      email: identity.email,
    });
    return account.userId;
  }

  /**
   * A brand-new person. The provider has already proven the address, so the
   * account is created ALREADY CONFIRMED — no verification email.
   */
  private async createAccount(
    identity: VerifiedIdentity,
    input: SocialSignInInput,
  ): Promise<{ userId: string; organizationId: number }> {
    const name = identity.name ?? identity.email.split('@')[0];
    if (input.audience === 'attendee') {
      const attendee = await this.repo.createAttendee(
        input.orgSlug as string,
        name,
        identity.email,
      );
      if (!attendee) {
        throw DomainException.notFound('That workspace does not exist.');
      }
      return attendee;
    }
    const organizationName = `${name}’s Workspace`;
    const slug = await this.signup.uniqueSlug(
      slugify(organizationName, 'workspace'),
    );
    const created = await this.signup.bootstrapWorkspace({
      organizationName,
      slug,
      name,
      email: identity.email,
      passwordHash: null, // social-only account — there is no password to guess
    });
    await this.signup.activateEmail(created.userId, created.organizationId);
    return { userId: created.userId, organizationId: created.organizationId };
  }

  private async verify(input: SocialSignInInput): Promise<VerifiedIdentity> {
    let identity: VerifiedIdentity;
    try {
      identity = await this.verifier.verify(input.provider, input.idToken);
    } catch {
      throw new DomainException(
        ErrorCode.UNAUTHORIZED,
        'We could not verify that sign-in. Please try again.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!identity.emailVerified) {
      throw DomainException.validation(
        `${input.provider} has not confirmed that email address.`,
      );
    }
    return identity;
  }

  /** The account must exist, be active, and belong to the audience in play. */
  private async loadEligible(
    userId: string,
    audience: Persona,
  ): Promise<LoginUser> {
    const found = await this.repo.loadLoginUser(userId);
    if (!found || found.user.persona !== audience) {
      throw new DomainException(
        ErrorCode.UNAUTHORIZED,
        'That account cannot sign in here.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (found.user.status === 'Suspended') {
      throw new DomainException(
        ErrorCode.ACCOUNT_SUSPENDED,
        'Your access has been suspended.',
        HttpStatus.FORBIDDEN,
      );
    }
    return found;
  }

  private assertNotCancelled(input: SocialSignInInput): void {
    if (input.error || !input.idToken) {
      throw new DomainException(
        ErrorCode.UNAUTHORIZED,
        input.error === CONSENT_DENIED || input.error
          ? 'Sign-in was cancelled.'
          : 'No sign-in token was supplied.',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private assertProviderAllowed(
    provider: SocialProvider,
    audience: Persona,
  ): void {
    if (!PROVIDERS_BY_AUDIENCE[audience].includes(provider)) {
      throw DomainException.validation(
        `${provider} sign-in is not available here.`,
      );
    }
  }
}
