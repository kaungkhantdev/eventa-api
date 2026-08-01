import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import { OrganizationService } from '../organization/organization.service';
import {
  PaymentSettingsResponseDto,
  toPaymentSettingsResponse,
} from './dto/payment-settings-response.dto';
import { PaymentSettingsRepository } from './payment-settings.repository';
import type {
  ConnectInput,
  PaymentSettingsRow,
  UpdatePreferencesInput,
} from './payment-settings.types';
import {
  PaymentProviderPort,
  type VerifyResult,
} from './ports/payment-provider.port';

/** Stripe's hard limit on what fits a card statement line. */
const MAX_DESCRIPTOR = 22;
const DESCRIPTOR_PATTERN = /^[A-Za-z0-9 .,'-]*$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * A workspace's payment connection and checkout preferences (US-SET-08/10).
 *
 * **PCI SAQ-A:** no card data and no provider secret ever passes through here.
 * Connecting stores only the provider's account reference and its publishable
 * key, so there is nothing sensitive to show back after saving.
 */
@Injectable()
export class PaymentSettingsService {
  constructor(
    private readonly repo: PaymentSettingsRepository,
    private readonly provider: PaymentProviderPort,
    private readonly organization: OrganizationService,
    private readonly clock: Clock,
  ) {}

  async get(organizationId: number): Promise<PaymentSettingsResponseDto> {
    return toPaymentSettingsResponse(
      await this.repo.findOrCreate(organizationId),
    );
  }

  /** Connect a provider account, proving it works before recording it. */
  async connect(
    organizationId: number,
    input: ConnectInput,
  ): Promise<PaymentSettingsResponseDto> {
    const check = await this.provider.verify(input.accountId);
    if (!check.ok) {
      throw DomainException.validation(
        `That payment account could not be verified: ${check.reason ?? 'unknown reason'}`,
      );
    }
    await this.repo.findOrCreate(organizationId);
    const saved = await this.repo.update(organizationId, {
      status: 'connected',
      accountId: input.accountId,
      publishableKey: input.publishableKey,
      mode: input.mode,
      connectedAt: this.clock.now(),
      disconnectedAt: null,
    });
    return toPaymentSettingsResponse(saved);
  }

  /** Prove the saved credentials work — read-only, no money moves. */
  async testConnection(organizationId: number): Promise<VerifyResult> {
    const current = await this.repo.findOrCreate(organizationId);
    if (current.status !== 'connected' || !current.accountId) {
      throw DomainException.validation(
        'Connect a payment account before testing the connection.',
      );
    }
    return this.provider.verify(current.accountId);
  }

  /**
   * Disconnect: paid checkout stops, free events keep working, and past orders
   * and payouts are untouched (nothing here writes to them).
   */
  async disconnect(
    organizationId: number,
  ): Promise<PaymentSettingsResponseDto> {
    await this.repo.findOrCreate(organizationId);
    const saved = await this.repo.update(organizationId, {
      status: 'disconnected',
      accountId: null,
      publishableKey: null,
      disconnectedAt: this.clock.now(),
    });
    return toPaymentSettingsResponse(saved);
  }

  /** Checkout & receipt preferences (US-SET-10). */
  async updatePreferences(
    organizationId: number,
    input: UpdatePreferencesInput,
  ): Promise<PaymentSettingsResponseDto> {
    this.assertValidPreferences(input);
    const warnings = await this.currencyWarnings(organizationId, input);
    await this.repo.findOrCreate(organizationId);
    const saved = await this.repo.update(organizationId, pickProvided(input));
    return { ...toPaymentSettingsResponse(saved), warnings };
  }

  private assertValidPreferences(input: UpdatePreferencesInput): void {
    const descriptor = input.statementDescriptor;
    if (descriptor != null) {
      if (descriptor.length > MAX_DESCRIPTOR) {
        throw DomainException.validation(
          `Statement descriptor must be ${MAX_DESCRIPTOR} characters or fewer.`,
        );
      }
      if (!DESCRIPTOR_PATTERN.test(descriptor)) {
        throw DomainException.validation(
          "Statement descriptor may use letters, numbers, spaces and . , ' -",
        );
      }
    }
    if (
      input.defaultCurrency !== undefined &&
      !CURRENCY_PATTERN.test(input.defaultCurrency)
    ) {
      throw DomainException.validation(
        'Currency must be a 3-letter ISO code (e.g. THB).',
      );
    }
  }

  /** A currency that differs from the workspace's warns, but never blocks. */
  private async currencyWarnings(
    organizationId: number,
    input: UpdatePreferencesInput,
  ): Promise<string[]> {
    if (input.defaultCurrency === undefined) return [];
    const org = await this.organization.get(organizationId);
    if (input.defaultCurrency === org.currency) return [];
    return [
      `Charge currency ${input.defaultCurrency} differs from the organization currency ${org.currency}.`,
    ];
  }
}

const PREFERENCE_KEYS = [
  'defaultCurrency',
  'statementDescriptor',
  'saveCards',
  'emailReceipts',
] as const satisfies readonly (keyof UpdatePreferencesInput)[];

/** Only the keys actually present — a partial save never blanks the others. */
function pickProvided(
  input: UpdatePreferencesInput,
): Partial<PaymentSettingsRow> {
  const values: Record<string, unknown> = {};
  for (const key of PREFERENCE_KEYS) {
    if (input[key] !== undefined) values[key] = input[key];
  }
  return values;
}
