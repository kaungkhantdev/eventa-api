import { Injectable } from '@nestjs/common';
import { formatBaht } from '../../common/money/baht';
import { DiscountRedemptionService } from '../discounts/discount-redemption.service';
import { SeatHoldService } from '../registration/seat-hold.service';
import { priceOrder } from './checkout-pricing';
import { CheckoutPolicy } from './checkout.policy';
import { CheckoutRepository } from './checkout.repository';
import { CheckoutViewService } from './checkout-view.service';
import {
  selectionSize,
  type CheckoutEvent,
  type CheckoutSelection,
  type CheckoutTier,
} from './checkout.types';
import type { CheckoutHoldDto, OrderSummaryDto } from './dto/order-summary.dto';

/** What the buyer picked, plus anything that changes the price. */
export interface QuoteCheckoutInput {
  eventId: string;
  ticketTypeId: string;
  quantity?: number;
  seatIds?: number[];
  discountCode?: string;
  /** Lets Discounts enforce a per-person redemption limit before the order exists. */
  buyerEmail?: string;
}

export type HoldCheckoutInput = Omit<
  QuoteCheckoutInput,
  'discountCode' | 'buyerEmail'
>;

export interface ReleaseCheckoutInput {
  eventId: string;
  holdIds: number[];
}

/**
 * The buyer's side of checkout (US-DISC-04): price a selection live, then
 * reserve the inventory behind it while they pay.
 *
 * Everything that decides money is re-resolved here rather than trusted from the
 * request. The event supplies the tenant; the catalog supplies the price; the
 * workspace row supplies the VAT and fee rates; Discounts decides what a code is
 * worth. A client can name what it wants to buy — never what it costs.
 *
 * Quoting and holding are deliberately separate. A quote touches nothing, so it
 * can run on every keystroke; a hold takes real inventory through the seat-hold
 * engine's row-locked transaction, which stays the only authority on whether a
 * seat is still free.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly view: CheckoutViewService,
    private readonly policy: CheckoutPolicy,
    private readonly discounts: DiscountRedemptionService,
    private readonly holds: SeatHoldService,
    private readonly repo: CheckoutRepository,
  ) {}

  /** Price the current selection. Reads only — safe to call as often as it changes. */
  async quote(input: QuoteCheckoutInput): Promise<OrderSummaryDto> {
    const { event, tier, selection } = await this.resolve(input);
    const quantity = selectionSize(selection);
    const subtotalSatang = tier.priceSatang * quantity;
    const discount = await this.discountFor(input, subtotalSatang);
    const rates = await this.repo.orgRates(event.organizationId);
    const totals = priceOrder({
      subtotalSatang,
      discountSatang: discount.discountSatang,
      ...rates,
    });
    return {
      eventId: event.id,
      ticketTypeId: tier.id,
      ticketTypeName: tier.name,
      quantity,
      seatIds: selection.mode === 'reserved' ? selection.seatIds : null,
      unitPriceSatang: tier.priceSatang,
      ...totals,
      discountCode: discount.code,
      labels: {
        subtotal: formatBaht(totals.subtotalSatang),
        discount:
          totals.discountSatang > 0 ? formatBaht(totals.discountSatang) : null,
        serviceFee: formatBaht(totals.serviceFeeSatang),
        total: formatBaht(totals.totalSatang),
      },
      // A free order skips payment entirely (US-DISC-04).
      paymentRequired: totals.totalSatang > 0,
    };
  }

  /** Reserve the selection so nobody else can take it while the buyer pays. */
  async hold(input: HoldCheckoutInput): Promise<CheckoutHoldDto> {
    const { event, selection } = await this.resolve(input);
    const actor = { organizationId: event.organizationId };
    const holds =
      selection.mode === 'reserved'
        ? await this.holds.holdSeats(actor, {
            eventId: event.id,
            seatIds: selection.seatIds,
          })
        : [
            await this.holds.holdQuantity(actor, {
              eventId: event.id,
              ticketTypeId: selection.ticketTypeId,
              quantity: selection.quantity,
            }),
          ];
    return {
      holdIds: holds.map((h) => h.id),
      expiresAt: holds[0].expiresAt.toISOString(),
    };
  }

  /** Give the inventory back — the buyer abandoned the checkout. */
  async release(input: ReleaseCheckoutInput): Promise<void> {
    if (input.holdIds.length === 0) return;
    const { event } = await this.view.load(input.eventId);
    await this.holds.release(
      { organizationId: event.organizationId },
      input.holdIds,
    );
  }

  /**
   * The one path into a checkout action: resolve the event (and with it the
   * tenant), the tier (and with it the price), and parse the pick into the shape
   * this event's seating mode allows.
   */
  private async resolve(input: QuoteCheckoutInput): Promise<{
    event: CheckoutEvent;
    tier: CheckoutTier;
    selection: CheckoutSelection;
  }> {
    const { event } = await this.view.load(input.eventId);
    const tier = await this.view.requireTier(
      event.organizationId,
      event.id,
      input.ticketTypeId,
    );
    const selection = this.policy.resolveSelection(event.seatingMode, input);
    this.policy.assertWithinTierBounds(tier, selectionSize(selection));
    if (selection.mode === 'reserved') {
      // Every chosen seat must exist, be free, and be priced by this tier —
      // checked here so a bad pick fails before the reservation transaction.
      this.policy.resolveSeats(
        await this.view.seatsFor(event),
        selection.seatIds,
        tier.id,
      );
    }
    return { event, tier, selection };
  }

  private async discountFor(
    input: QuoteCheckoutInput,
    subtotalSatang: number,
  ): Promise<{ discountSatang: number; code: string | null }> {
    if (!input.discountCode) return { discountSatang: 0, code: null };
    const quote = await this.discounts.quote({
      code: input.discountCode,
      eventId: input.eventId,
      subtotalSatang,
      buyerEmail: input.buyerEmail,
    });
    return { discountSatang: quote.discountSatang, code: quote.code };
  }
}
