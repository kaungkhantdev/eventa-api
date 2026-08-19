import type { eventStatusEnum } from '../../../db/schema';

/** The slice of an event the door needs. */
export interface CheckInEvent {
  id: string;
  status: (typeof eventStatusEnum.enumValues)[number];
  startAt: Date;
  endAt: Date | null;
}

/**
 * Check-in's view of the event it is admitting to. Events owns the table and
 * binds the adapter, so the door never reads another context's rows — and
 * resolving the event IS the tenancy check: one from another workspace simply
 * does not come back.
 */
export abstract class CheckInEventPort {
  abstract findForCheckIn(
    organizationId: number,
    eventId: string,
  ): Promise<CheckInEvent | null>;
}
