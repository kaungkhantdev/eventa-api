import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain.exception';
import type { EventActor, SeatingMode } from '../events.types';
import type { EventResponseDto } from '../dto/event-response.dto';
import { EventsService } from '../events.service';
import { TicketAvailabilityPort } from '../ports/ticket-availability.port';
import { SeatingResponseDto } from './dto/seating-response.dto';
import { SeatingRepository } from './seating.repository';
import type {
  ConfigureGeneralInput,
  ConfigureReservedInput,
  SeatMapRow,
  SeatPosition,
  SeatRow,
} from './seating.types';

const RESERVED: SeatingMode = 'reserved';
const GENERAL: SeatingMode = 'ga';
const SOLD = 'sold';
const ONLINE_NOTE =
  'Online events have no seating — a join link is emailed after registration.';

/** Configure an event's seating: general-admission headcount or a reserved map. */
@Injectable()
export class SeatingService {
  constructor(
    private readonly repo: SeatingRepository,
    private readonly events: EventsService,
    private readonly tickets: TicketAvailabilityPort,
  ) {}

  /** Lay out reserved seating (rows × seats). In-person only; keeps sold seats. */
  async configureReserved(
    actor: EventActor,
    eventId: string,
    input: ConfigureReservedInput,
  ): Promise<SeatingResponseDto> {
    const event = await this.events.getEvent(actor, eventId);
    this.assertInPerson(event);
    const desired = generatePositions(input.rows, input.seatsPerRow);
    // The repo does the locked read-diff-write + sold-seat guard atomically.
    const result = await this.repo.applyReserved(
      actor.organizationId,
      {
        eventId,
        name: input.name,
        rows: input.rows,
        seatsPerRow: input.seatsPerRow,
      },
      desired,
      event.status !== 'draft',
    );
    if (!result.ok) {
      throw DomainException.validation(
        'Seats that are already sold cannot be removed from a published event.',
      );
    }
    const updated = await this.events.updateEvent(actor, eventId, {
      seatingMode: RESERVED,
    });
    return this.respond(actor.organizationId, updated, result.map);
  }

  /** Choose general admission with a headcount; drops any reserved map. */
  async configureGeneral(
    actor: EventActor,
    eventId: string,
    input: ConfigureGeneralInput,
  ): Promise<SeatingResponseDto> {
    const event = await this.events.getEvent(actor, eventId);
    this.assertInPerson(event);
    const existing = await this.repo.getMapWithSeats(
      actor.organizationId,
      eventId,
    );
    if (existing) {
      this.assertNoSoldSeats(event, existing.seats);
      await this.repo.clearSeating(actor.organizationId, eventId);
    }
    const updated = await this.events.updateEvent(actor, eventId, {
      seatingMode: GENERAL,
      capacity: input.headcount,
    });
    return this.respond(actor.organizationId, updated, null);
  }

  /** The current seating configuration + a seat-map-vs-ticket shortfall warning. */
  async getSeating(
    actor: EventActor,
    eventId: string,
  ): Promise<SeatingResponseDto> {
    const event = await this.events.getEvent(actor, eventId);
    const map = event.isOnline
      ? null
      : await this.repo.findMap(actor.organizationId, eventId);
    return this.respond(actor.organizationId, event, map);
  }

  /** Copy the source event's seat map onto a new event (fresh, all-available seats). */
  async cloneForEvent(
    actor: EventActor,
    srcEventId: string,
    destEventId: string,
  ): Promise<void> {
    const map = await this.repo.findMap(actor.organizationId, srcEventId);
    if (!map?.layout) return;
    const { rows, seatsPerRow } = map.layout;
    await this.repo.applyReserved(
      actor.organizationId,
      { eventId: destEventId, name: map.name, rows, seatsPerRow },
      generatePositions(rows, seatsPerRow),
      false,
    );
  }

  /** A published event must never lose seats that are already sold. */
  private assertNoSoldSeats(
    event: EventResponseDto,
    candidates: SeatRow[],
  ): void {
    if (event.status === 'draft') return;
    if (candidates.some((s) => s.status === SOLD)) {
      throw DomainException.validation(
        'Seats that are already sold cannot be removed from a published event.',
      );
    }
  }

  private assertInPerson(event: EventResponseDto): void {
    if (event.isOnline) {
      throw DomainException.validation(ONLINE_NOTE);
    }
  }

  private async respond(
    organizationId: number,
    event: EventResponseDto,
    map: SeatMapRow | null,
  ): Promise<SeatingResponseDto> {
    if (event.isOnline) {
      return {
        seatingMode: event.seatingMode,
        isOnline: true,
        capacity: event.capacity,
        seatMap: null,
        ticketQuantity: 0,
        seatShortfall: null,
        note: ONLINE_NOTE,
      };
    }
    const ticketQuantity = await this.tickets.totalQuantity(
      organizationId,
      event.id,
    );
    const seatMap = map
      ? {
          name: map.name,
          rows: map.layout?.rows ?? 0,
          seatsPerRow: map.layout?.seatsPerRow ?? 0,
          totalSeats: map.totalSeats,
        }
      : null;
    const shortfall =
      event.seatingMode === RESERVED &&
      seatMap !== null &&
      seatMap.totalSeats < ticketQuantity;
    return {
      seatingMode: event.seatingMode,
      isOnline: false,
      capacity: event.capacity,
      seatMap,
      ticketQuantity,
      seatShortfall: shortfall
        ? { totalSeats: seatMap.totalSeats, ticketQuantity }
        : null,
      note: null,
    };
  }
}

/** Every seat position for a rows × seatsPerRow grid (row/seat are 1-based). */
function generatePositions(rows: number, seatsPerRow: number): SeatPosition[] {
  const positions: SeatPosition[] = [];
  for (let r = 1; r <= rows; r += 1) {
    for (let s = 1; s <= seatsPerRow; s += 1) {
      // section is '' (never null) so uq_seats_position actually enforces
      // uniqueness — a NULL would make Postgres treat every seat as distinct.
      positions.push({
        section: '',
        rowLabel: String(r),
        seatNumber: String(s),
      });
    }
  }
  return positions;
}
