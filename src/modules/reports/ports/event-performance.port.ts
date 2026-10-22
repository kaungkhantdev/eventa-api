import { EVENT_LIFECYCLES } from '../../../common/constants/reports.constants';

/**
 * What Reports needs to rank events against each other (US-RPT-04), without
 * reading the events, orders or tickets tables.
 *
 * Declared by the consumer and implemented by RegistrationStats, which already
 * owns the joins from `events` to both `orders` and `tickets`.
 */

export type EventLifecycle = (typeof EVENT_LIFECYCLES)[number];

/** One event's standing. Raw counts only; the rates are the service's. */
export interface EventPerformanceRow {
  eventId: string;
  eventName: string;
  startAt: Date;
  venueName: string | null;
  city: string | null;
  isOnline: boolean;
  lifecycle: EventLifecycle;
  /** Confirmed seats — the ranking metric, and what "registrations" means. */
  registrations: number;
  /** Live tickets issued: the attendance rate's denominator. */
  ticketed: number;
  checkedIn: number;
}

export interface EventPerformanceQuery {
  /** Which events, by when they RUN — not by when their orders came in. */
  from: Date;
  /** Exclusive. */
  to: Date;
  eventId?: string;
  /** Matches the event name. */
  search?: string;
  /** One stage of the lifecycle, or every stage when absent. */
  lifecycle?: EventLifecycle;
  page: number;
  limit: number;
}

export interface EventPerformancePage {
  rows: EventPerformanceRow[];
  /** How many events matched the filter in total, for paging. */
  matchedEvents: number;
}

export abstract class EventPerformancePort {
  /**
   * Events ranked best-first by registrations.
   *
   * Driven FROM `events`, so an event nobody signed up for still appears —
   * last. Every other per-event report starts from a fact table and so cannot
   * see one, which is right for "income by event" and wrong for "all events".
   */
  abstract rank(
    organizationId: number,
    query: EventPerformanceQuery,
  ): Promise<EventPerformancePage>;
}
