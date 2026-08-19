import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DomainException } from '../../common/errors/domain.exception';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import {
  generateTotpSecret,
  totpKeyUri,
  verifyTotp,
} from '../../common/crypto/totp';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { OutboxPort } from '../platform/outbox.port';
import { ProfileService } from '../users/profile.service';
import { AuthTwoFactorRepository } from './auth-two-factor.repository';
import { twoFactorDisabledEvent } from './events/two-factor-disabled.event';

/** The story's number: eight one-time codes, shown once. */
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_BYTES = 5; // → 10 hex chars, formatted as XXXXX-XXXXX
const ISSUER = 'Eventa';

export interface EnrolmentStart {
  otpauthUri: string;
  secret: string;
}
export interface TwoFactorStatus {
  enabled: boolean;
  pending: boolean;
  recoveryCodesRemaining: number;
}

/**
 * Two-factor sign-in with an authenticator app, plus one-time recovery codes
 * (US-SET-03 / US-ACC-07).
 *
 * The TOTP seed must be readable to verify a code, so it is **encrypted** at rest
 * (SecretCipher), never hashed. Recovery codes are the opposite — they are
 * one-time secrets we only ever compare, so only their hashes are stored and the
 * plaintext is shown exactly once.
 */
@Injectable()
export class AuthTwoFactorService {
  constructor(
    private readonly repo: AuthTwoFactorRepository,
    private readonly cipher: SecretCipher,
    private readonly profile: ProfileService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async status(auth: AuthContext): Promise<TwoFactorStatus> {
    const row = await this.repo.find(auth.organizationId, auth.userId);
    if (!row) {
      return { enabled: false, pending: false, recoveryCodesRemaining: 0 };
    }
    return {
      enabled: row.confirmedAt !== null,
      pending: row.confirmedAt === null,
      recoveryCodesRemaining:
        row.confirmedAt === null
          ? 0
          : await this.repo.countUnusedCodes(auth.organizationId, row.id),
    };
  }

  /** Begin setup: mint a seed and the otpauth:// URI the QR encodes. */
  async start(auth: AuthContext): Promise<EnrolmentStart> {
    const existing = await this.repo.find(auth.organizationId, auth.userId);
    if (existing?.confirmedAt) {
      throw DomainException.conflict(
        'Two-factor is already on. Turn it off first to re-enrol.',
      );
    }
    const me = await this.profile.get(auth);
    const secret = generateTotpSecret();
    const otpauthUri = totpKeyUri(me.email, ISSUER, secret);
    await this.repo.upsertPending(
      auth.organizationId,
      auth.userId,
      this.cipher.encrypt(secret),
      otpauthUri,
    );
    return { otpauthUri, secret };
  }

  /**
   * Finish setup with a code from the app. A wrong or expired code leaves
   * two-factor OFF; on success the member gets their 8 recovery codes, once.
   */
  async confirm(auth: AuthContext, code: string): Promise<string[]> {
    const row = await this.requireEnrolment(auth);
    if (row.confirmedAt) {
      throw DomainException.conflict('Two-factor is already on.');
    }
    this.assertCodeValid(row.secretEncrypted, code);
    const codes = generateRecoveryCodes();
    await this.repo.confirm(
      auth.organizationId,
      auth.userId,
      row.id,
      codes.map(hashCode),
      this.clock.now(),
    );
    return codes;
  }

  /** Turn it off — only after re-proving it's you, and tell the member by email. */
  async disable(auth: AuthContext, code: string): Promise<void> {
    const row = await this.requireEnrolment(auth);
    if (!row.confirmedAt) {
      throw DomainException.validation('Two-factor is not on.');
    }
    await this.assertCodeOrRecovery(auth, row.id, row.secretEncrypted, code);
    await this.repo.disable(auth.organizationId, auth.userId, row.id);
    const me = await this.profile.get(auth);
    await this.outbox.enqueue(
      twoFactorDisabledEvent({
        organizationId: auth.organizationId,
        userId: auth.userId,
        name: me.name,
        email: me.email,
        occurredAt: this.clock.now().toISOString(),
      }),
    );
  }

  /** Fresh set of 8; every previous code stops working immediately. */
  async regenerateRecoveryCodes(
    auth: AuthContext,
    code: string,
  ): Promise<string[]> {
    const row = await this.requireEnrolment(auth);
    if (!row.confirmedAt) {
      throw DomainException.validation('Turn two-factor on first.');
    }
    this.assertCodeValid(row.secretEncrypted, code);
    const codes = generateRecoveryCodes();
    await this.repo.replaceRecoveryCodes(
      auth.organizationId,
      row.id,
      codes.map(hashCode),
    );
    return codes;
  }

  /** Verify a 6-digit TOTP, or spend a recovery code (used at sign-in too). */
  async verify(
    organizationId: number,
    userId: string,
    code: string,
  ): Promise<boolean> {
    const row = await this.repo.find(organizationId, userId);
    if (!row?.confirmedAt) return false;
    if (this.isTotpValid(row.secretEncrypted, code)) return true;
    return this.repo.consumeRecoveryCode(
      organizationId,
      row.id,
      hashCode(code),
    );
  }

  private async assertCodeOrRecovery(
    auth: AuthContext,
    twoFactorId: number,
    secretEncrypted: Buffer,
    code: string,
  ): Promise<void> {
    if (this.isTotpValid(secretEncrypted, code)) return;
    const spent = await this.repo.consumeRecoveryCode(
      auth.organizationId,
      twoFactorId,
      hashCode(code),
    );
    if (!spent) throw this.badCode();
  }

  private assertCodeValid(secretEncrypted: Buffer, code: string): void {
    if (!this.isTotpValid(secretEncrypted, code)) throw this.badCode();
  }

  private isTotpValid(secretEncrypted: Buffer, code: string): boolean {
    const secret = this.cipher.decrypt(secretEncrypted);
    try {
      return verifyTotp(secret, code);
    } catch {
      return false;
    }
  }

  private async requireEnrolment(auth: AuthContext) {
    const row = await this.repo.find(auth.organizationId, auth.userId);
    if (!row) {
      throw DomainException.notFound('Start two-factor setup first.');
    }
    return row;
  }

  private badCode(): DomainException {
    return DomainException.validation(
      'That code is wrong or has expired — try the current one.',
    );
  }
}

/** `XXXXX-XXXXX`, easy to read off paper. */
function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const hex = randomBytes(RECOVERY_CODE_BYTES).toString('hex').toUpperCase();
    return `${hex.slice(0, 5)}-${hex.slice(5)}`;
  });
}

/** Recovery codes are compared, never shown again — store only the hash. */
function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}
