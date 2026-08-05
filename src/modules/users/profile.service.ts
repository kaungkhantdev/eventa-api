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
import { ProfileRepository } from './profile.repository';
import type { ProfileRow, UpdateProfileInput } from './users.types';

/** Fields a member may change on their own profile. */
const UPDATABLE_KEYS = [
  'name',
  'phone',
  'timezone',
  'locale',
  'avatarUrl',
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

function toProfileResponse(row: ProfileRow): ProfileResponseDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    pendingEmail: row.pendingEmail,
    emailVerified: row.pendingEmail === null,
    phone: row.phone,
    timezone: row.timezone,
    locale: row.locale,
    avatarUrl: row.avatarUrl,
    city: row.city,
    dateOfBirth: row.dateOfBirth,
    bio: row.bio,
    displayCurrency: row.displayCurrency,
  };
}
