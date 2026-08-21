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
  PaymentSettingsRow,
  UpdatePreferencesInput,
} from './payment-settings.types';

/** Stripe's hard limit on what fits a card statement line. */
const MAX_DESCRIPTOR = 22;
const DESCRIPTOR_PATTERN = /^[A-Za-z0-9 .,'-]*$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * A workspace's checkout and receipt preferences (US-SET-10).
 *
 * Reads the connection state but never changes it: the keys themselves belong to
 * `PaymentKeysService`, which is the only place a credential is handled. Keeping
 * that in one file is the point — a secret should have exactly one door.
 */
@Injectable()
export class PaymentSettingsService {
  constructor(
    private readonly repo: PaymentSettingsRepository,
    private readonly organization: OrganizationService,
    private readonly clock: Clock,
    /** `PUBLIC_API_URL` — where Stripe can reach this service. */
    private readonly publicApiUrl: string,
  ) {}

  async get(organizationId: number): Promise<PaymentSettingsResponseDto> {
    return toPaymentSettingsResponse(
      await this.repo.findOrCreate(organizationId),
      this.publicApiUrl,
    );
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
    return { ...toPaymentSettingsResponse(saved, this.publicApiUrl), warnings };
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
