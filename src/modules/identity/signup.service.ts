import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import { slugify } from '../../common/util/slugify';
import type { Env } from '../../config/env.validation';
import { OutboxPort } from '../platform/outbox.port';
import { RegisterResponseDto } from './dto/register-response.dto';
import { VerifyEmailResponseDto } from './dto/verify-email-response.dto';
import { emailVerificationRequestedEvent } from './events/email-verification-requested.event';
import { PasswordService } from './password.service';
import { SignupRepository } from './signup.repository';
import { TokenService } from './token.service';

const CHECK_INBOX_MESSAGE =
  'Check your inbox to confirm your email and finish signing up.';
const INVALID_LINK_MESSAGE =
  'This confirmation link is invalid or has expired. Request a new one.';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  organizationName?: string;
}

/** Organizer sign-up + email confirmation (US-ACC-01). */
@Injectable()
export class SignupService {
  private readonly publicWebUrl: string;

  constructor(
    private readonly repo: SignupRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  /**
   * Create a workspace + owner and send a confirmation email. Always returns the
   * same neutral acknowledgement — a taken email is never revealed and no duplicate
   * account is created (US-ACC-01).
   */
  async register(input: RegisterInput): Promise<RegisterResponseDto> {
    if (await this.repo.organizerEmailExists(input.email)) {
      return { message: CHECK_INBOX_MESSAGE };
    }
    const organizationName =
      input.organizationName ?? `${input.name}’s Workspace`;
    const slug = await this.repo.uniqueSlug(
      slugify(organizationName, 'workspace'),
    );
    const passwordHash = await this.passwords.hash(input.password);
    const { organizationId, userId } = await this.repo.bootstrapWorkspace({
      organizationName,
      slug,
      name: input.name,
      email: input.email,
      passwordHash,
    });
    await this.sendVerification(organizationId, userId, input);
    return { message: CHECK_INBOX_MESSAGE };
  }

  /** Confirm an account's email from its link; returns the slug to sign in with. */
  async verifyEmail(token: string): Promise<VerifyEmailResponseDto> {
    const claims = await this.decodeToken(token);
    const activated = await this.repo.activateEmail(claims.sub, claims.org);
    if (!activated) throw DomainException.validation(INVALID_LINK_MESSAGE);
    return { verified: true, orgSlug: activated.orgSlug };
  }

  private async sendVerification(
    organizationId: number,
    userId: string,
    input: RegisterInput,
  ): Promise<void> {
    const token = await this.tokens.signEmailVerification({
      userId,
      organizationId,
    });
    await this.outbox.enqueue(
      emailVerificationRequestedEvent({
        organizationId,
        userId,
        name: input.name,
        email: input.email,
        verifyUrl: `${this.publicWebUrl}/verify-email?token=${token}`,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
  }

  private async decodeToken(
    token: string,
  ): Promise<{ sub: string; org: number }> {
    try {
      return await this.tokens.verifyEmailVerification(token);
    } catch {
      throw DomainException.validation(INVALID_LINK_MESSAGE);
    }
  }
}
