import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PLATFORM_ORG_SLUG } from '../../common/tenancy/platform-org';
import { Clock } from '../../common/time/clock';
import { OutboxPort } from '../platform/outbox.port';
import { signedInEvent } from './events/signed-in.event';
import type {
  AuthContext,
  InviteTokenClaims,
  OrganizationRow,
  Persona,
  RefreshTokenClaims,
  UserRow,
} from './auth.types';
import { MeResponseDto, toMeResponse } from '../users/dto/user-response.dto';
import { PermissionsService } from '../access/permissions.service';
import { UsersRepository } from '../users/users.repository';
import { AuthRepository } from './auth.repository';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from '../auth-password/auth-password.service';
import { SignupService } from '../auth-signup/auth-signup.service';
import { TokenService } from './token.service';

export interface LoginInput {
  email: string;
  password: string;
  /** The organizer's workspace. Absent — and refused — for attendees (US-DISC-08). */
  orgSlug?: string;
  persona?: Persona;
  device: string;
  ip: string | null;
  rememberMe?: boolean;
}

export type { LoginUser };

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: MeResponseDto;
}

/** Password checked out, but a code is required before any session exists. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
  /** How long the code prompt is valid, seconds. */
  expiresIn: number;
}

export type LoginOutcome = LoginResult | TwoFactorChallenge;

export interface AcceptInviteResult {
  userId: string;
  email: string;
  status: 'Active';
}

type LoginUser = { user: UserRow; org: OrganizationRow };

/** A login whose workspace has been resolved — what the private steps consume. */
type ResolvedLoginInput = LoginInput & { orgSlug: string };

/** Brute-force throttle key for a sign-in attempt: realm + audience + email. */
function throttleIdentity(input: ResolvedLoginInput): string {
  return `${input.orgSlug}|${input.persona ?? 'admin'}|${input.email.toLowerCase()}`;
}

/**
 * Which workspace a login authenticates against (US-DISC-08). An organizer
 * names theirs. An attendee has exactly one — the platform organization — so
 * none is taken, and naming one is refused rather than ignored: a client that
 * sends a workspace for an attendee is confused, and should fail loudly rather
 * than be silently redirected.
 */
function resolveRealm(input: LoginInput): string {
  if ((input.persona ?? 'admin') === 'attendee') {
    if (input.orgSlug) {
      throw DomainException.validation(
        "Attendee sign-in doesn't take a workspace — leave orgSlug out.",
      );
    }
    return PLATFORM_ORG_SLUG;
  }
  if (!input.orgSlug) {
    throw DomainException.validation(
      'Organizer sign-in requires your workspace slug.',
    );
  }
  return input.orgSlug;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly users: UsersRepository,
    private readonly permissions: PermissionsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
    private readonly outbox: OutboxPort,
    private readonly throttle: LoginThrottleService,
    private readonly signup: SignupService,
  ) {}

  async login(input: LoginInput): Promise<LoginOutcome> {
    const resolved: ResolvedLoginInput = {
      ...input,
      orgSlug: resolveRealm(input),
    };
    const throttleId = throttleIdentity(resolved);
    await this.throttle.assertNotLocked(throttleId);
    const found = await this.authenticateThrottled(resolved, throttleId);
    await this.assertEligible(found);
    // A correct password is necessary but not sufficient (US-ACC-05): with 2FA
    // on, no session exists until the code checks out — the challenge token is
    // the only thing the password earns.
    if (found.user.twoFactorEnabled) {
      return this.issueTwoFactorChallenge(found, input);
    }
    return this.startSession(found, input);
  }

  private async issueTwoFactorChallenge(
    found: LoginUser,
    input: LoginInput,
  ): Promise<TwoFactorChallenge> {
    return {
      twoFactorRequired: true,
      challengeToken: await this.tokens.signTwoFactorChallenge({
        userId: found.user.id,
        organizationId: found.org.id,
        persona: found.user.persona,
        rememberMe: input.rememberMe ?? false,
      }),
      expiresIn: this.tokens.twoFactorChallengeTtlSeconds,
    };
  }

  /**
   * Open a session and mint tokens for an ALREADY-AUTHENTICATED user. Password
   * sign-in reaches this after checking the hash; social sign-in (US-ACC-06) after
   * the provider's id token verifies. Callers are responsible for proving identity
   * first — nothing here re-checks a credential.
   */
  async startSession(
    found: LoginUser,
    input: Omit<LoginInput, 'email' | 'password' | 'orgSlug'>,
  ): Promise<LoginResult> {
    const refreshTtl = input.rememberMe
      ? this.tokens.refreshTtlSeconds
      : this.tokens.refreshTtlShortSeconds;
    const sessionId = await this.openSession(found, input, refreshTtl);
    await this.recordSignIn(found, input);
    const { accessToken, refreshToken } = await this.issueTokens(
      found,
      sessionId,
      refreshTtl,
    );
    const permissions = await this.permissions.getFor(
      found.org.id,
      found.user.id,
    );
    return {
      accessToken,
      refreshToken,
      expiresIn: this.tokens.accessTtlSeconds,
      user: toMeResponse(found.user, found.org, permissions),
    };
  }

  /**
   * Authenticate, feeding the brute-force throttle: a wrong-credentials failure
   * (401) counts toward the lockout; an inactive-account refusal (403) does not
   * (that isn't password guessing); a success clears the counter.
   */
  private async authenticateThrottled(
    input: ResolvedLoginInput,
    throttleId: string,
  ): Promise<LoginUser> {
    let found: LoginUser;
    try {
      found = await this.authenticate(input);
    } catch (err) {
      if (
        err instanceof DomainException &&
        err.code === ErrorCode.UNAUTHORIZED
      ) {
        await this.throttle.recordFailure(throttleId);
      }
      throw err;
    }
    await this.throttle.recordSuccess(throttleId);
    return found;
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const claims = await this.verifyRefreshToken(refreshToken);
    await this.assertSessionLive(claims.sid);
    const accessToken = await this.tokens.signAccess({
      userId: claims.sub,
      organizationId: claims.org,
      sessionId: claims.sid,
      persona: claims.persona,
    });
    return { accessToken, expiresIn: this.tokens.accessTtlSeconds };
  }

  async me(auth: AuthContext): Promise<MeResponseDto> {
    const profile = await this.loadProfile(auth.userId);
    const permissions = await this.permissions.getFor(
      auth.organizationId,
      auth.userId,
    );
    return toMeResponse(profile.user, profile.org, permissions);
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.repo.revokeSession(auth.sessionId);
    await this.repo.recordAudit({
      organizationId: auth.organizationId,
      type: 'revoke',
      title: 'Signed out',
      actorUserId: auth.userId,
      ip: null,
    });
  }

  /** Accept a workspace invite: set the password and activate the membership. */
  async acceptInvite(
    token: string,
    password: string,
  ): Promise<AcceptInviteResult> {
    const claims = await this.verifyInviteToken(token);
    const target = await this.repo.findInvitedMembership(claims.mid);
    if (!target) throw this.invalidToken();
    const passwordHash = await this.passwords.hash(password);
    await this.repo.activateInvite(target.userId, claims.mid, passwordHash);
    return { userId: target.userId, email: target.email, status: 'Active' };
  }

  // ── login steps ──────────────────────────────────────────────────────────

  private async authenticate(input: ResolvedLoginInput): Promise<LoginUser> {
    const found = await this.users.findLoginUser(
      input.orgSlug,
      input.email,
      input.persona ?? 'admin',
    );
    if (!found?.user.passwordHash) return this.rejectInvalid(found, input);
    const ok = await this.passwords.verify(
      found.user.passwordHash,
      input.password,
    );
    if (!ok) return this.rejectInvalid(found, input);
    return found;
  }

  /**
   * Post-authentication eligibility (US-ACC-02): a confirmed, active account signs
   * in; an unconfirmed one is refused and re-sent a fresh confirmation email; a
   * suspended one is refused. These are not credential failures, so they don't count
   * toward the brute-force lockout.
   */
  private async assertEligible(found: LoginUser): Promise<void> {
    if (found.user.status === 'Active') return;
    if (found.user.status === 'Unconfirmed') {
      await this.signup.resendVerification({
        organizationId: found.org.id,
        userId: found.user.id,
        name: found.user.name,
        email: found.user.email,
      });
      throw new DomainException(
        ErrorCode.EMAIL_NOT_CONFIRMED,
        'Please confirm your email — we’ve sent you a fresh link.',
        HttpStatus.FORBIDDEN,
      );
    }
    // Invited is a DIFFERENT event: an admin created this account and it is
    // waiting on an invitation being accepted, not on an address being proven.
    // No confirmation link is owed, and sending one would point at the wrong
    // thing — the invite email holds the token that actually works.
    if (found.user.status === 'Invited') {
      throw new DomainException(
        ErrorCode.EMAIL_NOT_CONFIRMED,
        'Open the invitation we emailed you to finish setting up your account.',
        HttpStatus.FORBIDDEN,
      );
    }
    throw new DomainException(
      ErrorCode.ACCOUNT_SUSPENDED,
      'Your access has been suspended.',
      HttpStatus.FORBIDDEN,
    );
  }

  private openSession(
    found: LoginUser,
    input: Pick<LoginInput, 'device' | 'ip'>,
    refreshTtlSeconds: number,
  ): Promise<string> {
    const expiresAt = new Date(
      this.clock.now().getTime() + refreshTtlSeconds * 1000,
    );
    return this.repo.createSession({
      organizationId: found.org.id,
      userId: found.user.id,
      device: input.device,
      ip: input.ip,
      expiresAt,
    });
  }

  private async recordSignIn(
    found: LoginUser,
    input: Pick<LoginInput, 'device' | 'ip'>,
  ): Promise<void> {
    await this.users.touchLastActive(found.user.id);
    await this.outbox.enqueue(
      signedInEvent({
        organizationId: found.org.id,
        userId: found.user.id,
        device: input.device,
        ip: input.ip,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
  }

  private async issueTokens(
    found: LoginUser,
    sessionId: string,
    refreshTtlSeconds: number,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const subject = {
      userId: found.user.id,
      organizationId: found.org.id,
      sessionId,
      persona: found.user.persona,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signAccess(subject),
      this.tokens.signRefresh(subject, refreshTtlSeconds),
    ]);
    return { accessToken, refreshToken };
  }

  // ── refresh / me steps ───────────────────────────────────────────────────

  private async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    let claims: RefreshTokenClaims;
    try {
      claims = await this.tokens.verifyRefresh(token);
    } catch {
      throw this.invalidToken();
    }
    if (claims.typ !== 'refresh') throw this.invalidToken();
    return claims;
  }

  private async verifyInviteToken(token: string): Promise<InviteTokenClaims> {
    let claims: InviteTokenClaims;
    try {
      claims = await this.tokens.verifyInvite(token);
    } catch {
      throw this.invalidToken();
    }
    if (claims.typ !== 'invite') throw this.invalidToken();
    return claims;
  }

  private async assertSessionLive(sessionId: string): Promise<void> {
    const session = await this.repo.findValidSession(sessionId);
    if (!session) {
      throw new DomainException(
        ErrorCode.UNAUTHORIZED,
        'Session expired or revoked',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private async loadProfile(userId: string): Promise<LoginUser> {
    const profile = await this.users.findProfile(userId);
    if (!profile) {
      throw new DomainException(
        ErrorCode.UNAUTHORIZED,
        'User no longer exists',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return profile;
  }

  // ── failures ─────────────────────────────────────────────────────────────

  private async rejectInvalid(
    found: LoginUser | null,
    input: LoginInput,
  ): Promise<never> {
    if (found) await this.auditFail(found, input);
    throw this.invalidCredentials();
  }

  private auditFail(found: LoginUser, input: LoginInput): Promise<void> {
    return this.repo.recordAudit({
      organizationId: found.org.id,
      type: 'fail',
      title: `Failed sign-in for ${input.email}`,
      actorUserId: found.user.id,
      ip: input.ip,
    });
  }

  private invalidCredentials(): DomainException {
    return new DomainException(
      ErrorCode.UNAUTHORIZED,
      'Invalid email or password',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private invalidToken(): DomainException {
    return new DomainException(
      ErrorCode.UNAUTHORIZED,
      'Invalid or expired token',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
