/** The bare event facts the inventory list needs to label a tier. */
export interface EventBrief {
  id: string;
  name: string;
}

/**
 * Ticketing-owned port for the two event facts the cross-event inventory list
 * needs (US-TKT-04): the name to show beside each tier, and which events match a
 * search term so "jazz" finds tiers on the Jazz Festival as well as tiers called
 * "Jazz pass". Events implements it — Ticketing never joins the `events` table.
 */
export abstract class EventLookupPort {
  /** Names for the given events, keyed by id; unknown ids are simply absent. */
  abstract briefsByIds(
    organizationId: number,
    eventIds: string[],
  ): Promise<Map<string, EventBrief>>;

  /** Ids of this org's events whose name contains `search` (case-insensitive). */
  abstract idsMatchingName(
    organizationId: number,
    search: string,
  ): Promise<string[]>;
}
