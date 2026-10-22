import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Clock } from '../../common/time/clock';
import type { EventActor, SeatingMode } from '../events/events.types';
import type { EventResponseDto } from '../events/dto/event-response.dto';
import { EventsService } from '../events/events.service';
import { TicketAvailabilityPort } from '../events/ports/ticket-availability.port';
import { SeatingResponseDto } from './dto/seating-response.dto';
import {
  toSeatRows,
  unassignedRowCount,
  unassignedSeatCount,
} from './event-seating.mapper';
import { EventSeatingPolicy } from './event-seating.policy';
import { EventSeatingRepository } from './event-seating.repository';
import type {
  ConfigureGeneralInput,
  ConfigureReservedInput,
  SeatMapRow,
  SeatRow,
  SeatRowSummary,
} from './event-seating.types';
import {
  ONLINE_NOTE,
  SOLD,
} from '../../common/constants/event-seating.constants';

const RESERVED: SeatingMode = 'reserved';
const GENERAL: SeatingMode = 'ga';

/**
 * Configure an event's seating: general-admission headcount or a reserved map,
 * its seats split between the event's ticket types — seat by seat, or a whole
 * row at a time (US-EVT-05).
 */
@Injectable()
export class EventSeatingService {
  constructor(
    private readonly repo: EventSeatingRepository,
    private readonly events: EventsService,
    private readonly tickets: TicketAvailabilityPort,
    private readonly policy: EventSeatingPolicy,
    private readonly clock: Clock,
  ) {}

  /**
   * Lay out reserved seating (rows × seats) and give each seat a ticket type,
   * one by one or a row at a time. In-person only. The repository runs the
   * whole save under its locks and the policy decides it there, so a refusal
   * writes nothing.
   */
  async configureReserved(
    actor: EventActor,
    eventId: string,
    input: ConfigureReservedInput,
  ): Promise<SeatingResponseDto> {
    const event = await this.events.getEvent(actor, eventId);
    this.assertInPerson(event);
    this.policy.assertTypeShape(input);
    // A published event keeps its sold seats, and a type on every seat once
    // any seat has one; a draft may leave either open until it publishes.
    const published = event.status !== 'draft';
    const map = await this.repo.applyReserved(
      actor.organizationId,
      {
        eventId,
        name: input.name,
        rows: input.rows,
        seatsPerRow: input.seatsPerRow,
      },
      (snapshot) => this.policy.planReserved(snapshot, input, published),
      this.clock.now(),
    );
    const updated = await this.events.updateEvent(actor, eventId, {
      seatingMode: RESERVED,
    });
    return this.respond(actor.organizationId, updated, map);
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

  /**
   * Copy the source event's seat map onto a new event: fresh, all-available
   * seats, with no ticket types.
   */
  async cloneForEvent(
    actor: EventActor,
    srcEventId: string,
    destEventId: string,
  ): Promise<void> {
    const map = await this.repo.findMap(actor.organizationId, srcEventId);
    if (!map?.layout) return;
    const { rows, seatsPerRow } = map.layout;
    const input = { name: map.name, rows, seatsPerRow };
    await this.repo.applyReserved(
      actor.organizationId,
      { eventId: destEventId, ...input },
      (snapshot) => this.policy.planReserved(snapshot, input, false),
      this.clock.now(),
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
        rows: [],
        unassignedRows: 0,
        unassignedSeats: 0,
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
    const rows = await this.rowsOf(organizationId, map);
    return {
      seatingMode: event.seatingMode,
      isOnline: false,
      capacity: event.capacity,
      seatMap,
      rows,
      unassignedRows: unassignedRowCount(rows),
      unassignedSeats: unassignedSeatCount(rows),
      ticketQuantity,
      seatShortfall: shortfall
        ? { totalSeats: seatMap.totalSeats, ticketQuantity }
        : null,
      note: null,
    };
  }

  /** Each row of the map and its seats' ticket types; none without a map. */
  private async rowsOf(
    organizationId: number,
    map: SeatMapRow | null,
  ): Promise<SeatRowSummary[]> {
    if (!map) return [];
    return toSeatRows(await this.repo.seatTypes(organizationId, map.id));
  }
}
