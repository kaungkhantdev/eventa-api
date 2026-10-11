import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import { MessageResponseDto } from '../../common/http/message-response.dto';
import type { OutboxEventInput } from '../platform/outbox.port';
import {
  PasswordRepository,
  type ChangeAccount,
} from './auth-password.repository';
import { PasswordService } from './auth-password.service';
import { passwordChangedEvent } from './events/password-changed.event';

const WRONG_CURRENT = 'Your current password is incorrect.';
const REUSED = 'Please choose a password different from your current one.';
const CHANGED = 'Your password has been changed.';

/** Change a password while signed in (US-ACC-05 / US-SET-02). */
@Injectable()
export class PasswordChangeService {
  constructor(
    private readonly repo: PasswordRepository,
    private readonly passwords: PasswordService,
    private readonly clock: Clock,
  ) {}

  /**
   * Verify the current password, set the new one, sign out this user's OTHER
   * devices (the current session stays), and tell the account holder — all in
   * one transaction. Wrong current password → 403, nothing signed out and
   * nothing announced; new password equal to current → 422.
   */
  async change(
    actor: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<MessageResponseDto> {
    const account = await this.verified(actor, currentPassword, newPassword);
    await this.repo.setPassword(
      actor.organizationId,
      actor.userId,
      await this.passwords.hash(newPassword),
      actor.sessionId, // keep the current device signed in
      this.notice(actor, account),
    );
    return { message: CHANGED };
  }

  /**
   * The account, once the current password really is theirs and the new one is
   * not the same. Returned rather than merely asserted so the notice is
   * addressed from the row the change was authorized against, with no cast and
   * no second lookup that could find a different one.
   */
  private async verified(
    actor: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<ChangeAccount> {
    const account = await this.repo.findChangeAccount(
      actor.organizationId,
      actor.userId,
    );
    const hash = account?.passwordHash;
    if (
      !account ||
      !hash ||
      !(await this.passwords.verify(hash, currentPassword))
    ) {
      throw DomainException.forbidden(WRONG_CURRENT);
    }
    if (await this.passwords.verify(hash, newPassword)) {
      throw DomainException.validation(REUSED);
    }
    return account;
  }

  /**
   * The confirmation mail, as a builder the repository calls inside the write's
   * transaction — the only place the number of devices signed out is known, and
   * the only place the row is safe from committing without the change or the
   * change committing without the row.
   */
  private notice(
    actor: AuthContext,
    account: ChangeAccount,
  ): (otherSessionsSignedOut: number) => OutboxEventInput {
    const occurredAt = this.clock.now().toISOString();
    return (otherSessionsSignedOut) =>
      passwordChangedEvent({
        organizationId: actor.organizationId,
        userId: actor.userId,
        name: account.name,
        email: account.email,
        otherSessionsSignedOut,
        occurredAt,
      });
  }
}
