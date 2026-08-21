import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SecretCipher } from '../../common/crypto/secret-cipher';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import { PaymentCredentialsRepository } from './payment-credentials.repository';
import { PaymentSettingsRepository } from './payment-settings.repository';
import type { PaymentMode } from './payment-settings.types';
import { assertKeysMatchMode, maskedTail } from './stripe-keys';
import {
  PaymentProviderPort,
  type VerifyResult,
} from './ports/payment-provider.port';

/** Long enough that a webhook URL cannot be found by guessing. */
const WEBHOOK_TOKEN_BYTES = 18;

/** The one environment where charging a real card is the intended outcome. */
const PRODUCTION = 'production';

/** What a workspace submits from the API keys card. */
export interface SaveKeysInput {
  mode: PaymentMode;
  publishableKey: string;
  secretKey: string;
  /** Absent means "leave the stored one alone" — see `saveKeys`. */
  webhookSecret?: string;
}

/**
 * Everything the screen is allowed to know about stored keys.
 *
 * Note what is absent, and deliberately: the secret key and the webhook signing
 * secret. `secretKeyMasked` answers the only question a settings page has to —
 * *which* key is saved — and is useless for anything else.
 */
export interface StoredKeysView {
  mode: PaymentMode;
  publishableKey: string;
  secretKeyMasked: string;
  webhookSecretSet: boolean;
  savedAt: Date | null;
}

/**
 * A workspace's own Stripe keys (US-SET-08).
 *
 * Eventa charges with the organizer's key, so this is the seam where a
 * credential enters the product. Three rules hold it together:
 *
 * - **Nothing is stored until Stripe agrees it works.** Saving first would mark
 *   a workspace ready to take money on a key that never worked, and the
 *   discovery would be a buyer's failed checkout rather than a message here.
 * - **The plaintext secret never leaves this file.** It is encrypted on the way
 *   in and decrypted only to hand to a Stripe client. It is never returned,
 *   never logged, and never put in an error.
 * - **Each mode is independent.** Test and live keys are separate rows, so an
 *   organizer can hold both and switch between them without one erasing the
 *   other.
 */
@Injectable()
export class PaymentKeysService {
  constructor(
    private readonly credentials: PaymentCredentialsRepository,
    private readonly settings: PaymentSettingsRepository,
    private readonly provider: PaymentProviderPort,
    private readonly cipher: SecretCipher,
    private readonly clock: Clock,
    /** `NODE_ENV`, for the live-key guard below. */
    private readonly environment: string,
  ) {}

  /** Validate, prove against Stripe, then encrypt and store — in that order. */
  async saveKeys(
    organizationId: number,
    input: SaveKeysInput,
  ): Promise<StoredKeysView> {
    assertKeysMatchMode(input.mode, input.publishableKey, input.secretKey);
    this.assertModeAllowedHere(input.mode);
    const verified = await this.assertKeyWorks(input.secretKey);
    const current = await this.settings.findOrCreate(organizationId);
    const now = this.clock.now();

    await this.credentials.save(organizationId, input.mode, {
      publishableKey: input.publishableKey,
      secretKeyCipher: this.cipher.encrypt(input.secretKey),
      // `undefined`, not null: re-pasting API keys says nothing about the
      // signing secret, which lives on a different page in Stripe. Blanking it
      // would silently stop every order settling.
      ...(input.webhookSecret
        ? { webhookSecretCipher: this.cipher.encrypt(input.webhookSecret) }
        : {}),
      savedAt: now,
    });

    await this.settings.update(organizationId, {
      status: 'connected',
      mode: input.mode,
      accountId: verified.accountId ?? null,
      publishableKey: input.publishableKey,
      connectedAt: current.connectedAt ?? now,
      disconnectedAt: null,
      // Minted once and then left alone: a rotated token would orphan the
      // endpoint the organizer already registered with Stripe.
      ...(current.webhookToken ? {} : { webhookToken: newWebhookToken() }),
    });

    return this.describe(organizationId, input.mode);
  }

  /** What the screen may show. Never a secret. */
  async describe(
    organizationId: number,
    mode: PaymentMode,
  ): Promise<StoredKeysView> {
    const row = await this.credentials.find(organizationId, mode);
    if (!row) return emptyView(mode);
    return {
      mode,
      publishableKey: row.publishableKey ?? '',
      secretKeyMasked: maskedTail(this.plaintextOf(row.secretKeyCipher)),
      webhookSecretSet: row.webhookSecretCipher !== null,
      savedAt: row.savedAt,
    };
  }

  /** Prove the stored key still works. Read-only — no money moves. */
  async testConnection(organizationId: number): Promise<VerifyResult> {
    const settings = await this.settings.findOrCreate(organizationId);
    const secret = await this.secretFor(organizationId, settings.mode);
    return this.provider.verifyKey(secret);
  }

  /**
   * Stop using this workspace's Stripe, and forget its keys — both modes.
   * Keeping a credential after being told to stop holding it is the whole
   * problem with storing one. Past orders and payouts are untouched.
   */
  async disconnect(organizationId: number): Promise<void> {
    await this.settings.findOrCreate(organizationId);
    await this.credentials.deleteAll(organizationId);
    await this.settings.update(organizationId, {
      status: 'disconnected',
      accountId: null,
      publishableKey: null,
      disconnectedAt: this.clock.now(),
    });
  }

  /** The decrypted key for one call. Callers hold it no longer than that. */
  async secretFor(organizationId: number, mode: PaymentMode): Promise<string> {
    const row = await this.credentials.find(organizationId, mode);
    const secret = row && this.plaintextOf(row.secretKeyCipher);
    if (!secret) {
      throw DomainException.validation(
        `No ${mode} keys are saved yet. Paste your Stripe keys above and save them first.`,
      );
    }
    return secret;
  }

  /** The signing secret for this workspace's webhook, or null if unset. */
  async webhookSecretFor(
    organizationId: number,
    mode: PaymentMode,
  ): Promise<string | null> {
    const row = await this.credentials.find(organizationId, mode);
    return row ? this.plaintextOf(row.webhookSecretCipher) : null;
  }

  /**
   * Refuse a live key anywhere but production.
   *
   * This guard used to live in env validation, against the single platform key.
   * It moved here with the credential: the hazard is identical and so is the
   * reason. Outside production, a live key means a seed script, a test run or
   * somebody clicking around a staging box can charge a real card belonging to
   * a real person — and nothing about the screen would show it had happened.
   */
  private assertModeAllowedHere(mode: PaymentMode): void {
    if (mode === 'live' && this.environment !== PRODUCTION) {
      throw DomainException.invalidField(
        'mode',
        `Live keys are only accepted in production; this server is running as "${this.environment}". Use your Stripe test keys here.`,
      );
    }
  }

  /**
   * Returns the verdict rather than parking it on the instance. This service is
   * a singleton serving every workspace: an instance field would be read by
   * whichever save happened to run next, and would put one organizer's account
   * id on another's settings row.
   */
  private async assertKeyWorks(secretKey: string): Promise<VerifyResult> {
    const check = await this.provider.verifyKey(secretKey);
    if (!check.ok) {
      // Named against the field, so the reason lands under the box it was
      // pasted into rather than at the foot of the card.
      throw DomainException.invalidField(
        'secretKey',
        `That key could not be used: ${check.reason ?? 'Stripe gave no reason'}`,
      );
    }
    return check;
  }

  private plaintextOf(payload: Buffer | null): string | null {
    return payload ? this.cipher.decrypt(payload) : null;
  }
}

function emptyView(mode: PaymentMode): StoredKeysView {
  return {
    mode,
    publishableKey: '',
    secretKeyMasked: '',
    webhookSecretSet: false,
    savedAt: null,
  };
}

function newWebhookToken(): string {
  return randomBytes(WEBHOOK_TOKEN_BYTES).toString('base64url');
}
