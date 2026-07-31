import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.validation';
import { OutboxPort } from '../platform/outbox.port';
import { Persona } from './auth.types';
import { MessageResponseDto } from './dto/message-response.dto';
import { passwordResetRequestedEvent } from './events/password-reset-requested.event';
import { passwordFingerprint } from './password-fingerprint';
import { PasswordRepository } from './password.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const LINK_ON_ITS_WAY =
  'If an account matches, a password-reset link is on its way.';
const RESET_DONE = 'Your password has been reset. Please sign in.';
const INVALID_LINK =
  'This reset link is invalid or has expired. Request a new one.';
const REUSED_PASSWORD =
  'Please choose a password different from your current one.';

/** Forgotten-password reset by email link (US-ACC-04). */
@Injectable()
export class PasswordResetService {
  private readonly publicWebUrl: string;

  constructor(
    private readonly repo: PasswordRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  /** Always returns the same neutral message — a registered email is never revealed. */
  async forgot(email: string, persona?: Persona): Promise<MessageResponseDto> {
    const user = await this.repo.findByEmailPersona(
      email,
      persona ?? Persona.Admin,
    );
    if (user?.passwordHash) {
      await this.sendResetLink(
        user.id,
        user.organizationId,
        user.name,
        email,
        user.passwordHash,
      );
    }
    return { message: LINK_ON_ITS_WAY };
  }

  /**
   * Set a new password from a valid, single-use link, then sign out every device.
   * Rejects a stale/used link and a password equal to the current one.
   */
  async reset(token: string, newPassword: string): Promise<MessageResponseDto> {
    const claims = await this.decode(token);
    const currentHash = await this.repo.currentHash(claims.org, claims.sub);
    if (!currentHash || passwordFingerprint(currentHash) !== claims.pv) {
      throw DomainException.validation(INVALID_LINK);
    }
    if (await this.passwords.verify(currentHash, newPassword)) {
      throw DomainException.validation(REUSED_PASSWORD);
    }
    const passwordHash = await this.passwords.hash(newPassword);
    await this.repo.setPassword(claims.org, claims.sub, passwordHash);
    return { message: RESET_DONE };
  }

  private async sendResetLink(
    userId: string,
    organizationId: number,
    name: string,
    email: string,
    passwordHash: string,
  ): Promise<void> {
    const token = await this.tokens.signPasswordReset({
      userId,
      organizationId,
      passwordFingerprint: passwordFingerprint(passwordHash),
    });
    await this.outbox.enqueue(
      passwordResetRequestedEvent({
        organizationId,
        userId,
        name,
        email,
        resetUrl: `${this.publicWebUrl}/reset-password?token=${token}`,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
  }

  private async decode(
    token: string,
  ): Promise<{ sub: string; org: number; pv: string }> {
    try {
      return await this.tokens.verifyPasswordReset(token);
    } catch {
      throw DomainException.validation(INVALID_LINK);
    }
  }
}
