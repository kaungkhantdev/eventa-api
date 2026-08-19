import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import { LoginThrottleService } from '../auth/login-throttle.service';
import { PasswordService } from '../auth-password/auth-password.service';
import { AuthTwoFactorService } from '../auth-two-factor/auth-two-factor.service';
import { AccountDeletionRepository } from './account-deletion.repository';
import type { AccountRow } from './account-deletion.types';
import type { DeletionWarningDto } from './dto/deletion-warning.dto';
import { accountDeletionRequestedEvent } from './events/account-deletion-requested.event';

export interface DeleteAccountInput {
  password: string;
  code?: string;
}

/**
 * The throttle realm for re-verification guessing — per account, its own realm
 * so deletion strikes never lock sign-in (and vice versa). Same lockout as the
 * password: a six-digit code without a throttle is a keyspace, not a secret,
 * and this one guards an irreversible action.
 */
const throttleId = (userId: string) => `delete|${userId}`;

const NOT_AN_ATTENDEE =
  'Only attendee accounts can be deleted here — workspace members are managed by their organization.';
const WRONG_PASSWORD =
  "That password didn't match — your account is unchanged.";
const NO_PASSWORD_SET =
  'Your account signs in with a social provider. Please set a password first (via password reset) to re-verify your identity.';
const CODE_REQUIRED =
  'Your authenticator code is required to delete this account.';
const WRONG_CODE = "That code didn't match — your account is unchanged.";
const ACCOUNT_GONE = 'Your session is no longer valid. Please sign in again.';
const SCHEDULED =
  'Your account is scheduled for deletion and you have been signed out everywhere. A confirmation email is on its way.';

/**
 * Delete my account (US-DISC-14): the danger zone warns about upcoming paid,
 * non-refundable tickets first; deletion itself demands the password again —
 * plus the authenticator code when 2FA is enrolled — and then soft-deletes,
 * signs out every device, and hands the rest (confirmation email, PDPA
 * anonymization with financial records retained disassociated) to the worker
 * via the transactional outbox. A failed re-verification changes nothing.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly repo: AccountDeletionRepository,
    private readonly passwords: PasswordService,
    private readonly twoFactor: AuthTwoFactorService,
    private readonly throttle: LoginThrottleService,
  ) {}

  /** The danger-zone preflight: what deleting right now walks away from. */
  async warning(auth: AuthContext): Promise<DeletionWarningDto> {
    const account = await this.requireAttendee(auth);
    const [upcoming, twoFactorStatus] = await Promise.all([
      this.repo.upcomingPaidOrders(account.email),
      this.twoFactor.status(auth),
    ]);
    return {
      requiresTwoFactorCode: twoFactorStatus.enabled,
      upcomingPaidOrders: upcoming.map((o) => ({
        reference: o.reference,
        eventName: o.eventName,
        startAt: o.startAt.toISOString(),
        ticketCount: o.ticketCount,
        totalSatang: o.totalSatang,
      })),
      totalAtRiskSatang: upcoming.reduce((sum, o) => sum + o.totalSatang, 0),
    };
  }

  async deleteAccount(
    auth: AuthContext,
    input: DeleteAccountInput,
  ): Promise<{ message: string }> {
    const account = await this.requireAttendee(auth);
    await this.throttle.assertNotLocked(throttleId(auth.userId));
    await this.reverifyIdentity(auth, account, input);
    await this.throttle.recordSuccess(throttleId(auth.userId));
    const scheduled = await this.repo.scheduleDeletion(
      auth.organizationId,
      auth.userId,
      accountDeletionRequestedEvent({
        organizationId: account.organizationId,
        userId: account.id,
        name: account.name,
        email: account.email,
        occurredAt: new Date().toISOString(),
      }),
    );
    if (!scheduled) throw DomainException.unauthorized(ACCOUNT_GONE);
    return { message: SCHEDULED };
  }

  private async requireAttendee(auth: AuthContext): Promise<AccountRow> {
    const account = await this.repo.findAccount(
      auth.organizationId,
      auth.userId,
    );
    if (!account) throw DomainException.unauthorized(ACCOUNT_GONE);
    if (account.persona !== 'attendee') {
      throw DomainException.forbidden(NOT_AN_ATTENDEE);
    }
    return account;
  }

  /** Password always; the authenticator code too when 2FA is enrolled. */
  private async reverifyIdentity(
    auth: AuthContext,
    account: AccountRow,
    input: DeleteAccountInput,
  ): Promise<void> {
    if (!account.passwordHash) {
      throw DomainException.forbidden(NO_PASSWORD_SET);
    }
    const passwordOk = await this.passwords.verify(
      account.passwordHash,
      input.password,
    );
    if (!passwordOk) {
      await this.throttle.recordFailure(throttleId(auth.userId));
      throw DomainException.forbidden(WRONG_PASSWORD);
    }
    const { enabled } = await this.twoFactor.status(auth);
    if (!enabled) return;
    if (!input.code) throw DomainException.validation(CODE_REQUIRED);
    const codeOk = await this.twoFactor.verify(
      auth.organizationId,
      auth.userId,
      input.code,
    );
    if (!codeOk) {
      await this.throttle.recordFailure(throttleId(auth.userId));
      throw DomainException.forbidden(WRONG_CODE);
    }
  }
}
