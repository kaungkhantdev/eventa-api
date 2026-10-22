import { Injectable } from '@nestjs/common';
import {
  type PublicSeatMap,
  PublicSeatMapPort,
} from '../public-pages/ports/public-seat-map.port';
import { toPublicSeatMap, toSeatRows } from './event-seating.mapper';
import { EventSeatingRepository } from './event-seating.repository';

/**
 * Seating's implementation of PublicPages' `PublicSeatMapPort` (US-PAGE-05):
 * how an event's seats are split between its ticket types, read from the
 * seats this module owns. The caller passes the event's own organization, so
 * an anonymous page can only read its own event's map.
 */
@Injectable()
export class PublicSeatMapAdapter extends PublicSeatMapPort {
  constructor(private readonly repo: EventSeatingRepository) {
    super();
  }

  async typedSeatMap(
    organizationId: number,
    eventId: string,
  ): Promise<PublicSeatMap | null> {
    const map = await this.repo.findMap(organizationId, eventId);
    if (!map) return null;
    const seats = await this.repo.seatTypes(organizationId, map.id);
    return toPublicSeatMap(map.layout, toSeatRows(seats));
  }
}
