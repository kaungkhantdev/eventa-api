import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.validation';
import { OutboxPort } from '../platform/outbox.port';
import { Persona } from '../auth/auth.types';
import { MessageResponseDto } from '../../common/http/message-response.dto';
import { passwordResetRequestedEvent } from './events/password-reset-requested.event';
import { passwordFingerprint } from './auth-password-fingerprint';
import { PasswordRepository } from './auth-password.repository';
import { PasswordService } from './auth-password.service';
import { TokenService } from '../auth/token.service';
import { LoginThrottleService } from '../auth/login-throttle.service';

const LINK_ON_ITS_WAY = 'A password-reset link is on its way.';

/** What each audience's account is called, for a message someone has to act on. */
const AUDIENCE: Record<Persona, string> = {
  [Persona.Admin]: 'organizer',
  [Persona.Attendee]: 'attendee',
};

function noSuchAccount(persona: Persona): string {
  const other = persona === Persona.Admin ? 'attendee' : 'organizer';
  return `No ${AUDIENCE[persona]} account uses that email address. Check the spelling, try your ${other} account, or create one.`;
}

const SOCIAL_ONLY =
  'That account signs in with Google, so it has no password to reset. Use “Continue with Google” instead.';
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
    private readonly throttle: LoginThrottleService,
    private readonly clock: Clock,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  /**
   * Send the reset link, or say plainly why there is none to send (US-ACC-04).
   *
   * This DELIBERATELY departs from the usual advice that a reset form answer
   * uniformly whether or not an account exists. Silence is indistinguishable
   * from a mail that was sent and lost: people wait, resend, and wait again for
   * a link that could never have been written — most often because the address
   * belongs to the other audience, which the neutral answer cannot say.
   *
   * The cost is accepted with eyes open: this endpoint now confirms whether an
   * account exists. `LoginThrottleService` is what stops that being a way to
   * farm the list — a miss counts against the identity exactly as a failed
   * sign-in does, and enough of them lock it out. A scripted sweep gets a few
   * answers and then 429s; somebody who mistyped their own address gets help.
   */
  async forgot(email: string, persona?: Persona): Promise<MessageResponseDto> {
    const audience = persona ?? Persona.Admin;
    const identity = this.identityOf(email, audience);
    // Before the lookup, so a locked identity learns nothing at all — not even
    // the timing difference between a hit and a miss.
    await this.throttle.assertNotLocked(identity, 'reset');

    const user = await this.repo.findByEmailPersona(email, audience);
    if (!user) {
      await this.throttle.recordFailure(identity);
      throw DomainException.notFound(noSuchAccount(audience));
    }
    // Not counted as a miss: the account exists, so this reveals nothing a
    // probe did not already learn, and it is a real answer to a real question.
    if (!user.passwordHash) {
      throw DomainException.validation(SOCIAL_ONLY);
    }

    await this.sendResetLink(
      user.id,
      user.organizationId,
      user.name,
      email,
      user.passwordHash,
    );
    return { message: LINK_ON_ITS_WAY };
  }

  /** Matches the sign-in throttle's shape: one count per audience per address. */
  private identityOf(email: string, persona: Persona): string {
    return `forgot|${persona}|${email.toLowerCase()}`;
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
