import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { paymentMethodEnum } from '../../db/schema';
import { PaymentSettingsRepository } from './payment-settings.repository';
import type { PaymentMethod } from './payment-settings.types';
import { TicketSalesPort } from './ports/ticket-sales.port';

/** Every method the product knows about — derived from the schema enum. */
const ALL_METHODS = paymentMethodEnum.enumValues;

/** Wallets ride on a connected provider account; they can't stand alone. */
const WALLET_METHODS: readonly PaymentMethod[] = ['Apple Pay', 'Google Pay'];

export interface PaymentMethodView {
  method: PaymentMethod;
  enabled: boolean;
}

/**
 * Which ways attendees may pay (US-SET-09). A facet of payment settings: same
 * bounded concern, its own rules — prerequisites and the last-method guard.
 */
@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly repo: PaymentSettingsRepository,
    private readonly sales: TicketSalesPort,
  ) {}

  /** All known methods; a method with no stored row is simply disabled. */
  async list(organizationId: number): Promise<PaymentMethodView[]> {
    const stored = await this.repo.listMethods(organizationId);
    const enabled = new Map(stored.map((r) => [r.method, r.enabled]));
    return ALL_METHODS.map((method) => ({
      method,
      enabled: enabled.get(method) ?? false,
    }));
  }

  async setEnabled(
    organizationId: number,
    method: PaymentMethod,
    enabled: boolean,
  ): Promise<PaymentMethodView[]> {
    if (enabled) await this.assertPrerequisites(organizationId, method);
    else await this.assertNotLastWhileSelling(organizationId);
    await this.repo.setMethod(organizationId, method, enabled);
    return this.list(organizationId);
  }

  /** A wallet needs the provider connection its charges ride on. */
  private async assertPrerequisites(
    organizationId: number,
    method: PaymentMethod,
  ): Promise<void> {
    if (!WALLET_METHODS.includes(method)) return;
    const settings = await this.repo.findOrCreate(organizationId);
    if (settings.status !== 'connected') {
      throw DomainException.validation(
        `Connect a payment account before enabling ${method}.`,
      );
    }
  }

  /** Never leave a workspace that sells paid tickets with no way to pay. */
  private async assertNotLastWhileSelling(
    organizationId: number,
  ): Promise<void> {
    if ((await this.repo.countEnabledMethods(organizationId)) > 1) return;
    if (!(await this.sales.hasPaidTickets(organizationId))) return;
    throw DomainException.validation(
      'Keep at least one payment method enabled while you sell paid tickets.',
    );
  }
}
