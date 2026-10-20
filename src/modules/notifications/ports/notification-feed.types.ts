import { FEED_KINDS } from '../../../common/constants/notifications.constants';

/**
 * What one thing that happened looks like, whichever module it came from
 * (US-MSG-03).
 *
 * FACTS, not prose. The feed is bilingual EN/TH, so the sentence a reader sees
 * is composed at the edge from these fields — an English title built here could
 * never be translated, and would put presentation in the wrong half of the
 * product.
 */

export type FeedKind = (typeof FEED_KINDS)[number];

/**
 * One item, before a reader is attached to it.
 *
 * Every optional field is null rather than absent: "no amount" and "an amount
 * you may not see" are both nulls here, and which one it is depends on the
 * reader, not on the item.
 */
export interface FeedItem {
  /** Stable across requests: `<source>:<row id>`, so paging never repeats one. */
  id: string;
  kind: FeedKind;
  at: Date;
  eventId: string | null;
  eventName: string | null;
  /** Who it concerns — the buyer, the payer. Null where nobody is named. */
  personName: string | null;
  /** Integer satang. Null where the item is not about money. */
  amountSatang: number | null;
  /** Seats on the registration. Null for anything that is not one. */
  seats: number | null;
  /** The payout's own reference, for the one kind that has one. */
  reference: string | null;
}

/** How far back to look, and how many of the newest to take. */
export interface FeedWindow {
  since: Date;
  limit: number;
}
