import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Paginated } from '../../common/http/paginated';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { PaymentProviderPort } from '../payments/ports/payment-provider.port';
import type { PayoutDetailDto, PayoutEntryDto } from './dto/payouts.dto';
import { toPayoutDetail, toPayoutEntry } from './payouts.mapper';
import { PayoutsRepository } from './payouts.repository';
import type { Balances, PayoutFilters, PayoutRow } from './payouts.types';
import { PayoutAccountPort } from './ports/payout-account.port';
import { SettledFundsPort } from './ports/settled-funds.port';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

const NOT_FAILED =
  'Only a failed payout can be retried — this one has not failed.';
const NOT_CONNECTED =
  'Connect a payout account before moving money to your bank.';

export interface PayoutSettingsLink {
  connected: boolean;
  /** A one-time provider URL, or null when there is no account to manage. */
  url: string | null;
}

/**
 * Payouts: balances, settlement history, and recovering a failed transfer
 * (US-FIN-03/04/05).
 *
 * Bank details never enter this service. The destination is a masked
 * descriptor, and everything an organizer might want to CHANGE about it lives
 * behind a one-time link to the provider's own dashboard — which is what keeps
 * Eventa out of PCI/bank-data scope.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly repo: PayoutsRepository,
    private readonly funds: SettledFundsPort,
    private readonly account: PayoutAccountPort,
    private readonly provider: PaymentProviderPort,
    private readonly clock: Clock,
  ) {}

  /**
   * The three headline balances. An unconnected workspace reports null rather
   * than ฿0 — "not set up yet" and "you have earned nothing" are different
   * facts, and showing the second for the first is alarming and wrong.
   */
  async balances(auth: AuthContext): Promise<Balances> {
    const account = await this.account.findAccount(auth.organizationId);
    if (!account.connected) {
      return {
        availableSatang: null,
        pendingSatang: null,
        paidOutSatang: null,
        payoutsConnected: false,
      };
    }
    const [lifetime, allocated, totals] = await Promise.all([
      this.funds.lifetimeNetSatang(auth.organizationId),
      this.repo.allocatedSatang(auth.organizationId),
      this.repo.totalsByStatus(auth.organizationId),
    ]);
    return {
      // Floored at zero: refunds can outrun the unallocated balance, and the
      // shortfall belongs in the next payout, not in a negative headline.
      availableSatang: Math.max(0, lifetime - allocated),
      pendingSatang: totals.pending,
      paidOutSatang: totals.paid,
      payoutsConnected: true,
    };
  }

  async list(
    auth: AuthContext,
    query: Partial<PayoutFilters>,
  ): Promise<Paginated<PayoutEntryDto>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const result = await this.repo.page(auth.organizationId, {
      ...query,
      page,
      limit,
    });
    return Paginated.of(
      result.items.map(toPayoutEntry),
      result.total,
      page,
      limit,
    );
  }

  async detail(auth: AuthContext, reference: string): Promise<PayoutDetailDto> {
    return toPayoutDetail(await this.require(auth, reference));
  }

  /**
   * Re-submit a failed payout. The provider issues a fresh transfer but the
   * EXISTING row is updated, so an organizer never sees two payouts for money
   * that only ever moved once (US-FIN-04).
   */
  async retry(auth: AuthContext, reference: string): Promise<PayoutDetailDto> {
    const payout = await this.require(auth, reference);
    if (payout.status !== 'failed') {
      throw DomainException.conflict(NOT_FAILED);
    }
    const account = await this.account.findAccount(auth.organizationId);
    if (!account.connected) throw DomainException.conflict(NOT_CONNECTED);
    const outcome = await this.provider.retryPayout({
      reference: payout.reference,
      amountSatang: payout.amountSatang,
      currency: payout.currency,
      accountId: account.accountId,
    });
    const updated = await this.repo.markRetried(
      auth.organizationId,
      reference,
      {
        status: outcome.status,
        gatewayRef: outcome.payoutRef || null,
        failureReason: outcome.failureReason,
        retriedBy: auth.userId,
        now: this.clock.now(),
      },
    );
    if (outcome.status === 'failed') {
      this.logger.warn(
        { reference, reason: outcome.failureReason },
        'payout retry refused by the provider',
      );
      throw new DomainException(
        ErrorCode.INTERNAL_ERROR,
        `The provider refused the payout: ${outcome.failureReason ?? 'no reason given'}.`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    return toPayoutDetail(updated);
  }

  /** A one-time link onto the provider's dashboard (US-FIN-05). */
  async settingsLink(auth: AuthContext): Promise<PayoutSettingsLink> {
    const account = await this.account.findAccount(auth.organizationId);
    if (!account.connected) return { connected: false, url: null };
    return {
      connected: true,
      url: await this.provider.payoutSettingsLink(account.accountId),
    };
  }

  private async require(
    auth: AuthContext,
    reference: string,
  ): Promise<PayoutRow> {
    const payout = await this.repo.findByReference(
      auth.organizationId,
      reference,
    );
    if (!payout) throw DomainException.notFound('Payout not found.');
    return payout;
  }
}
