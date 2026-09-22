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
import {
  decideReset,
  type ResettableAccount,
} from './auth-password-reset.eligibility';
import { PasswordRepository } from './auth-password.repository';
import { PasswordService } from './auth-password.service';
import { TokenService } from '../auth/token.service';
import { LoginThrottleService } from '../auth/login-throttle.service';

/**
 * The same words however many links went out. Counting them would tell an
 * anonymous caller how many workspaces the address belongs to — which sign-in
 * reveals only after the password checks out. Each email names its own.
 */
const LINK_ON_ITS_WAY = 'A password-reset link is on its way.';

/**
 * How many accounts on one address a single request looks at. Each usable one
 * gets its own email, so this bounds what an anonymous caller can make the form
 * send — the same bound sign-in puts on the accounts it checks.
 */
const MAX_RESET_ACCOUNTS = 10;

/** What each audience's account is called, for a message someone has to act on. */
const AUDIENCE: Record<Persona, string> = {
  [Persona.Admin]: 'organizer',
  [Persona.Attendee]: 'attendee',
};

function noSuchAccount(persona: Persona): string {
  const other = persona === Persona.Admin ? 'attendee' : 'organizer';
  return `No ${AUDIENCE[persona]} account uses that email address. Check the spelling, try your ${other} account, or create one.`;
}

const RESET_DONE = 'Your password has been reset. Please sign in.';
const INVALID_LINK =
  'This reset link is invalid or has expired. Request a new one.';
const REUSED_PASSWORD =
  'Please choose a password different from your current one.';

/**
 * Which workspace an email should say it opens. An organizer can hold accounts
 * in several and gets a link for each, so each says which. An attendee's only
 * realm is the platform organization, not a workspace they chose — naming it
 * would only puzzle them.
 */
function workspaceNamed(
  account: ResettableAccount,
  audience: Persona,
): string | undefined {
  return audience === Persona.Admin ? account.workspaceName : undefined;
}

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

    const accounts = await this.repo.findResetAccounts(
      email,
      audience,
      MAX_RESET_ACCOUNTS,
    );
    if (accounts.length === 0) {
      await this.throttle.recordFailure(identity, 'reset');
      throw DomainException.notFound(noSuchAccount(audience));
    }
    // A refusal from here on is not a miss against the lock: it is about the
    // accounts' own state, not somebody guessing at whether one exists.
    const decision = decideReset(accounts);
    if ('refuse' in decision) throw DomainException.validation(decision.refuse);

    for (const account of decision.send) {
      await this.sendResetLink(account, email, audience);
    }
    return { message: LINK_ON_ITS_WAY };
  }

  /**
   * One count per audience per address. It needs no marker of its own: the
   * throttle keeps reset counts under a prefix no sign-in identity can spell.
   */
  private identityOf(email: string, persona: Persona): string {
    return `${persona}|${email.toLowerCase()}`;
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
    account: ResettableAccount,
    email: string,
    audience: Persona,
  ): Promise<void> {
    const token = await this.tokens.signPasswordReset({
      userId: account.id,
      organizationId: account.organizationId,
      passwordFingerprint: passwordFingerprint(account.passwordHash),
    });
    await this.outbox.enqueue(
      passwordResetRequestedEvent({
        organizationId: account.organizationId,
        userId: account.id,
        name: account.name,
        email,
        workspaceName: workspaceNamed(account, audience),
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
