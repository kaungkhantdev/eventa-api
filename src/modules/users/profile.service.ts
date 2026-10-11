import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import type { Env } from '../../config/env.validation';
import type { AuthContext } from '../auth/auth.types';
import { TokenService } from '../auth/token.service';
import { OutboxPort } from '../platform/outbox.port';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { emailChangeRequestedEvent } from './events/email-change-requested.event';
import { toProfileResponse } from './profile.mapper';
import { ProfileRepository } from './profile.repository';
import type { ProfileRow, UpdateProfileInput } from './users.types';

/**
 * Fields a member may change on their own profile.
 *
 * Two are deliberately ABSENT. `avatarUrl`: a photo is only ever set by
 * `setAvatarUrl`, after the profile-photo module has verified an upload it
 * issued — accepting a hand-written URL here would let anyone point their
 * avatar at any address on the internet. `phone`: a number must be confirmed
 * by a texted code before Eventa sends to it (US-DISC-11 AC3), so it moves
 * through `PhoneVerificationService` exactly as `email` moves through
 * `requestEmailChange`. A number writable here would be textable the instant
 * it was typed, which is the whole of what that criterion forbids.
 */
const UPDATABLE_KEYS = [
  'name',
  'timezone',
  'locale',
  'city',
  'dateOfBirth',
  'bio',
  'displayCurrency',
] as const satisfies readonly (keyof UpdateProfileInput)[];

/**
 * A member's own profile (US-SET-01) — the identity colleagues reach them by, and
 * the timezone/language the console renders in. A member edits only themselves;
 * changing anyone else is Team administration (US-SET-11).
 */
@Injectable()
export class ProfileService {
  private readonly publicWebUrl: string;

  constructor(
    private readonly repo: ProfileRepository,
    private readonly tokens: TokenService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  async get(auth: AuthContext): Promise<ProfileResponseDto> {
    return toProfileResponse(await this.load(auth));
  }

  async update(
    auth: AuthContext,
    input: UpdateProfileInput,
  ): Promise<ProfileResponseDto> {
    assertUsableTimezone(input.timezone);
    const saved = await this.repo.update(
      auth.organizationId,
      auth.userId,
      pickProvided(input),
    );
    if (!saved) throw DomainException.notFound('Profile not found.');
    return toProfileResponse(saved);
  }

  /**
   * Set (or clear) the profile photo. Called by the profile-photo module once it
   * has confirmed an upload it issued the key for — the only route by which an
   * `avatarUrl` reaches this table.
   */
  async setAvatarUrl(
    auth: AuthContext,
    avatarUrl: string | null,
  ): Promise<ProfileResponseDto> {
    const saved = await this.repo.update(auth.organizationId, auth.userId, {
      avatarUrl,
    });
    if (!saved) throw DomainException.notFound('Profile not found.');
    return toProfileResponse(saved);
  }

  /**
   * Ask to move to a new address. The current email keeps working for sign-in and
   * is shown as unverified until the link — sent to the NEW address — is opened.
   */
  async requestEmailChange(
    auth: AuthContext,
    email: string,
  ): Promise<ProfileResponseDto> {
    const current = await this.load(auth);
    if (email === current.email) {
      throw DomainException.validation(
        'That is already the email on your account.',
      );
    }
    if (await this.repo.emailTaken(auth.organizationId, auth.userId, email)) {
      throw DomainException.conflict(
        'That email is already used in this workspace.',
      );
    }
    const saved = await this.repo.update(auth.organizationId, auth.userId, {
      pendingEmail: email,
    });
    if (!saved) throw DomainException.notFound('Profile not found.');
    await this.sendConfirmation(auth, current.name, email);
    return toProfileResponse(saved);
  }

  /** Open the link: promote the pending address to the sign-in email. */
  async confirmEmailChange(token: string): Promise<ProfileResponseDto> {
    const claims = await this.decode(token);
    const saved = await this.repo.promoteEmail(
      claims.org,
      claims.sub,
      claims.email,
    );
    if (!saved) {
      throw DomainException.validation(
        'This confirmation link is invalid or has already been used.',
      );
    }
    return toProfileResponse(saved);
  }

  private async sendConfirmation(
    auth: AuthContext,
    name: string,
    email: string,
  ): Promise<void> {
    const token = await this.tokens.signEmailChange({
      userId: auth.userId,
      organizationId: auth.organizationId,
      email,
    });
    await this.outbox.enqueue(
      emailChangeRequestedEvent({
        organizationId: auth.organizationId,
        userId: auth.userId,
        name,
        email,
        confirmUrl: `${this.publicWebUrl}/confirm-email?token=${token}`,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
  }

  private async decode(
    token: string,
  ): Promise<{ sub: string; org: number; email: string }> {
    try {
      return await this.tokens.verifyEmailChange(token);
    } catch {
      throw DomainException.validation(
        'This confirmation link is invalid or has expired.',
      );
    }
  }

  private async load(auth: AuthContext): Promise<ProfileRow> {
    const row = await this.repo.find(auth.organizationId, auth.userId);
    if (!row) throw DomainException.notFound('Profile not found.');
    return row;
  }
}

/** Reject a timezone the runtime cannot actually format in. */
function assertUsableTimezone(timezone?: string | null): void {
  if (timezone == null) return;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw DomainException.validation(`Unknown timezone "${timezone}".`);
  }
}

function pickProvided(input: UpdateProfileInput): Partial<ProfileRow> {
  const values: Record<string, unknown> = {};
  for (const key of UPDATABLE_KEYS) {
    if (input[key] !== undefined) values[key] = input[key];
  }
  return values;
}
