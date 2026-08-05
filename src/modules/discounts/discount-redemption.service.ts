import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import { quoteDiscount } from './discount-quote';
import { toSnapshot } from './discounts.mapper';
import { DiscountsPolicy } from './discounts.policy';
import { DiscountsRepository } from './discounts.repository';
import { EventOrgLookupPort } from './ports/event-org-lookup.port';
import type {
  DiscountQuoteInput,
  DiscountQuoteResult,
} from './discounts.types';
import type { DiscountSnapshot } from './discounts.types';

const SATANG_PER_BAHT = 100;

/**
 * Applying a code at checkout (US-TKT-11) — the attendee-facing half of
 * promotions. It only ever quotes: no order exists yet, so nothing is redeemed
 * and no counter moves. The redemption itself lands inside the checkout
 * transaction when `POST /orders` arrives.
 *
 * Every refusal names its own reason, because "invalid code" tells a buyer
 * nothing about whether to wait, spend more, or give up.
 */
@Injectable()
export class DiscountRedemptionService {
  constructor(
    private readonly repo: DiscountsRepository,
    private readonly policy: DiscountsPolicy,
    private readonly events: EventOrgLookupPort,
    private readonly clock: Clock,
  ) {}

  async quote(input: DiscountQuoteInput): Promise<DiscountQuoteResult> {
    if (input.subtotalSatang <= 0) {
      throw DomainException.validation(
        "There's nothing to discount — this order is already free.",
      );
    }
    // The event decides the workspace, so a code from another one is unreachable.
    const organizationId = await this.events.organizationIdFor(input.eventId);
    if (organizationId === null) {
      throw DomainException.notFound("This event isn't available.");
    }

    const code = this.policy.normaliseCode(input.code);
    const row = await this.repo.findUsable(organizationId, code, input.eventId);
    if (!row) {
      throw DomainException.validation(
        `"${code}" isn't a code we recognise for this event.`,
      );
    }

    const snapshot = toSnapshot(row);
    this.assertUsable(snapshot, input);
    await this.assertBuyerHasRoom(organizationId, snapshot, input.buyerEmail);

    const vatRate = await this.repo.orgVatRate(organizationId);
    const quote = quoteDiscount(snapshot, input.subtotalSatang, vatRate);
    return {
      applied: true,
      discountCodeId: snapshot.id,
      code: snapshot.code,
      type: snapshot.type,
      value: snapshot.value,
      subtotalSatang: input.subtotalSatang,
      ...quote,
    };
  }

  /** Window, switch, scope, overall limit and minimum order — in that order. */
  private assertUsable(
    code: DiscountSnapshot,
    input: DiscountQuoteInput,
  ): void {
    const now = this.clock.now();
    if (code.status === 'disabled') {
      throw DomainException.validation(
        `"${code.code}" is no longer available.`,
      );
    }
    if (code.validFrom && now.getTime() < code.validFrom.getTime()) {
      throw DomainException.validation(`"${code.code}" isn't active yet.`);
    }
    if (this.policy.isPastWindow(code, now)) {
      throw DomainException.validation(`"${code.code}" has expired.`);
    }
    if (code.eventId !== null && code.eventId !== input.eventId) {
      throw DomainException.validation(
        `"${code.code}" can't be used for this event.`,
      );
    }
    if (this.policy.isExhausted(code)) {
      throw DomainException.validation(
        `"${code.code}" has reached its redemption limit.`,
      );
    }
    if (input.subtotalSatang < code.minOrderSatang) {
      const shortfall = code.minOrderSatang - input.subtotalSatang;
      throw DomainException.validation(
        `Add ${formatBaht(shortfall)} more to use "${code.code}".`,
      );
    }
  }

  /**
   * The per-person limit needs an identity, and at quote time the buyer may not
   * have typed their email yet. Skipping it here is safe: the redemption itself
   * re-checks inside the checkout transaction, where the email is known.
   */
  private async assertBuyerHasRoom(
    organizationId: number,
    code: DiscountSnapshot,
    buyerEmail?: string,
  ): Promise<void> {
    if (code.perPersonLimit === 0 || !buyerEmail) return;
    const used = await this.repo.redemptionsByBuyer(
      organizationId,
      code.id,
      buyerEmail,
    );
    if (used < code.perPersonLimit) return;
    throw DomainException.validation(`You've already used "${code.code}".`);
  }
}

/** "฿500" / "฿1,250.50" — what the buyer still needs to add. */
function formatBaht(satang: number): string {
  const baht = satang / SATANG_PER_BAHT;
  return `฿${baht.toLocaleString('en-US', {
    minimumFractionDigits: baht % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
