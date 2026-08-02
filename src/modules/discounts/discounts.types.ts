import type { discountCodes } from '../../db/schema';

export type DiscountRow = typeof discountCodes.$inferSelect;
export type NewDiscountValues = typeof discountCodes.$inferInsert;
export type DiscountType = DiscountRow['type'];
export type DiscountStatus = DiscountRow['status'];

/** Who is acting, and in which workspace. */
export interface DiscountActor {
  organizationId: number;
  userId: string;
}

export interface CreateDiscountInput {
  code: string;
  type: DiscountType;
  value: number;
  /** Null / omitted = applies to every event in the workspace. */
  eventId?: string | null;
  redemptionLimit?: number;
  perPersonLimit?: number;
  minOrderSatang?: number;
  validFrom?: Date | null;
  validUntil?: Date | null;
}

export interface UpdateDiscountInput {
  code?: string;
  type?: DiscountType;
  value?: number;
  eventId?: string | null;
  redemptionLimit?: number;
  perPersonLimit?: number;
  minOrderSatang?: number;
  validFrom?: Date | null;
  validUntil?: Date | null;
  version?: number;
}

/** Filters for the promotions table (US-TKT-12). */
export interface ListDiscountsQuery {
  page?: number;
  limit?: number;
  status?: DiscountStatus;
  eventId?: string;
  search?: string;
}

export interface SearchDiscountsOptions {
  limit: number;
  offset: number;
  status?: DiscountStatus;
  /** Matches this event's own codes AND workspace-wide codes. */
  eventId?: string;
  search?: string;
  eventIds?: string[];
}

/** What became of a code on delete (US-TKT-09). */
export interface DeleteDiscountResult {
  outcome: 'removed' | 'retired';
}

/** The facts the redemption rules judge, independent of storage. */
export interface DiscountSnapshot {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  status: DiscountStatus;
  eventId: string | null;
  used: number;
  redemptionLimit: number;
  perPersonLimit: number;
  minOrderSatang: number;
  validFrom: Date | null;
  validUntil: Date | null;
}

/** What the attendee is asking about at checkout (US-TKT-11). */
export interface DiscountQuoteInput {
  code: string;
  eventId: string;
  /** The VAT-inclusive order subtotal, in satang. */
  subtotalSatang: number;
  /** Optional at quote time; required before the redemption is recorded. */
  buyerEmail?: string;
}

/** The applied discount, with VAT restated on what is actually charged. */
export interface DiscountQuoteResult {
  applied: true;
  discountCodeId: string;
  code: string;
  type: DiscountType;
  value: number;
  subtotalSatang: number;
  discountSatang: number;
  totalSatang: number;
  netSatang: number;
  vatSatang: number;
}
