import { ticketStatusEnum } from '../../db/schema';

/** The sellable status of a ticket tier (derived from the `ticket_status` enum). */
export type TierStatus = (typeof ticketStatusEnum.enumValues)[number];

/** What a Discover card can shout about its inventory, or nothing at all. */
export type DiscoverBadge = 'waitlist' | 'selling_fast';

/** The slice of a tier the browse rules judge — price and remaining stock. */
export interface TierInventory {
  priceSatang: number;
  isFree: boolean;
  status: TierStatus;
  sold: number;
  /** Allocation; `0` means unlimited, mirroring `TicketingPolicy`. */
  total: number;
}

/** The cheapest way in, once sold-out tiers are set aside. */
export interface PriceFrom {
  satang: number;
  isFree: boolean;
}

/** One published, publicly-visible event as the browse query returns it. */
export interface DiscoverEventRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: string;
  categoryName: string | null;
  startAt: Date;
  endAt: Date | null;
  timezone: string;
  isOnline: boolean;
  venueName: string | null;
  city: string | null;
  coverImage: string | null;
  organizerName: string;
}

/** What the visitor asked for. Every field is optional — the bare page works. */
export interface DiscoverQuery {
  q?: string;
  category?: string;
  page?: number;
  limit?: number;
}

/** A normalised browse query, ready for the repository. */
export interface DiscoverSearch {
  search?: string;
  category?: string;
  limit: number;
  offset: number;
}
