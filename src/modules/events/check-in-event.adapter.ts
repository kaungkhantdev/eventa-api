import { Injectable } from '@nestjs/common';
import {
  type CheckInEvent,
  CheckInEventPort,
} from '../check-in/ports/check-in-event.port';
import { EventsRepository } from './events.repository';

/**
 * Events' implementation of Check-in's `CheckInEventPort`. Events owns the
 * table; the door asks it whether the event exists in this workspace and when
 * it runs, rather than reading those rows itself.
 */
@Injectable()
export class CheckInEventAdapter extends CheckInEventPort {
  constructor(private readonly repo: EventsRepository) {
    super();
  }

  async findForCheckIn(
    organizationId: number,
    eventId: string,
  ): Promise<CheckInEvent | null> {
    const event = await this.repo.findEvent(organizationId, eventId);
    if (!event) return null;
    return {
      id: event.id,
      status: event.status,
      startAt: event.startAt,
      endAt: event.endAt,
    };
  }
}
