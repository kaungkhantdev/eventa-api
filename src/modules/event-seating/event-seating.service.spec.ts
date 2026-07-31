import { DomainException } from '../../common/errors/domain.exception';
import type { EventResponseDto } from '../events/dto/event-response.dto';
import { EventsService } from '../events/events.service';
import { TicketAvailabilityPort } from '../events/ports/ticket-availability.port';
import { EventSeatingRepository } from './event-seating.repository';
import { EventSeatingService } from './event-seating.service';
import type { SeatMapRow, SeatRow } from './event-seating.types';

const actor = { organizationId: 1, userId: 'u1' };
const eventId = 'e1';

function eventDto(o: Partial<EventResponseDto> = {}): EventResponseDto {
  return {
    id: eventId,
    isOnline: false,
    status: 'draft',
    seatingMode: 'ga',
    capacity: null,
    version: 1,
    ...o,
  } as unknown as EventResponseDto;
}

function seatMapRow(o: Partial<SeatMapRow> = {}): SeatMapRow {
  return {
    id: 5,
    organizationId: 1,
    eventId: 'e1',
    name: 'Main Hall',
    layout: { rows: 2, seatsPerRow: 3 },
    totalSeats: 6,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    ...o,
  };
}

function seatRow(o: Partial<SeatRow> = {}): SeatRow {
  return {
    id: 100,
    organizationId: 1,
    seatMapId: 5,
    section: null,
    rowLabel: '3',
    seatNumber: '1',
    ticketTypeId: null,
    status: 'available',
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    ...o,
  };
}

describe('EventSeatingService', () => {
  let repo: jest.Mocked<EventSeatingRepository>;
  let events: jest.Mocked<EventsService>;
  let tickets: jest.Mocked<TicketAvailabilityPort>;
  let service: EventSeatingService;

  beforeEach(() => {
    repo = {
      getMapWithSeats: jest.fn().mockResolvedValue(null),
      findMap: jest.fn().mockResolvedValue(null),
      applyReserved: jest.fn().mockImplementation(
        (
          _o: number,
          p: {
            eventId: string;
            name: string;
            rows: number;
            seatsPerRow: number;
          },
        ) =>
          Promise.resolve({
            ok: true,
            map: seatMapRow({
              eventId: p.eventId,
              name: p.name,
              layout: { rows: p.rows, seatsPerRow: p.seatsPerRow },
              totalSeats: p.rows * p.seatsPerRow,
            }),
          }),
      ),
      clearSeating: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EventSeatingRepository>;
    events = {
      getEvent: jest.fn().mockResolvedValue(eventDto()),
      updateEvent: jest
        .fn()
        .mockImplementation((_a, _id, input: Partial<EventResponseDto>) =>
          Promise.resolve(eventDto(input)),
        ),
    } as unknown as jest.Mocked<EventsService>;
    tickets = {
      totalQuantity: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<TicketAvailabilityPort>;
    service = new EventSeatingService(repo, events, tickets);
  });

  describe('configureReserved', () => {
    it('refuses seating for an online event (422)', async () => {
      events.getEvent.mockResolvedValue(eventDto({ isOnline: true }));
      const err = await service
        .configureReserved(actor, eventId, {
          name: 'Hall',
          rows: 2,
          seatsPerRow: 3,
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.applyReserved).not.toHaveBeenCalled();
    });

    it('lays out rows × seats for a fresh event and switches the mode', async () => {
      const res = await service.configureReserved(actor, eventId, {
        name: 'Grand Hall',
        rows: 2,
        seatsPerRow: 3,
      });
      const [, , desired, blockSoldRemoval] = repo.applyReserved.mock.calls[0];
      expect(desired).toHaveLength(6);
      expect(blockSoldRemoval).toBe(false); // draft
      expect(events.updateEvent).toHaveBeenCalledWith(actor, eventId, {
        seatingMode: 'reserved',
      });
      expect(res.seatMap?.totalSeats).toBe(6);
    });

    it('blocks the layout when the repo refuses (a sold seat would be lost) — 422', async () => {
      events.getEvent.mockResolvedValue(eventDto({ status: 'upcoming' }));
      repo.applyReserved.mockResolvedValue({ ok: false });
      const err = await service
        .configureReserved(actor, eventId, {
          name: 'Hall',
          rows: 2,
          seatsPerRow: 3,
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(events.updateEvent).not.toHaveBeenCalled();
    });

    it('tells the repo to guard sold seats on a published event', async () => {
      events.getEvent.mockResolvedValue(eventDto({ status: 'upcoming' }));
      await service.configureReserved(actor, eventId, {
        name: 'Hall',
        rows: 2,
        seatsPerRow: 3,
      });
      expect(repo.applyReserved.mock.calls[0][3]).toBe(true);
    });
  });

  describe('configureGeneral', () => {
    it('refuses seating for an online event (422)', async () => {
      events.getEvent.mockResolvedValue(eventDto({ isOnline: true }));
      const err = await service
        .configureGeneral(actor, eventId, { headcount: 100 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
    });

    it('sets the headcount + mode and clears any existing map', async () => {
      repo.getMapWithSeats.mockResolvedValue({
        map: seatMapRow(),
        seats: [seatRow({ status: 'available' })],
      });
      const res = await service.configureGeneral(actor, eventId, {
        headcount: 250,
      });
      expect(repo.clearSeating).toHaveBeenCalledWith(1, eventId);
      expect(events.updateEvent).toHaveBeenCalledWith(actor, eventId, {
        seatingMode: 'ga',
        capacity: 250,
      });
      expect(res.seatMap).toBeNull();
      expect(res.capacity).toBe(250);
    });

    it('refuses to switch away from reserved when seats are sold (422)', async () => {
      events.getEvent.mockResolvedValue(eventDto({ status: 'upcoming' }));
      repo.getMapWithSeats.mockResolvedValue({
        map: seatMapRow(),
        seats: [seatRow({ status: 'sold' })],
      });
      const err = await service
        .configureGeneral(actor, eventId, { headcount: 100 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.clearSeating).not.toHaveBeenCalled();
    });
  });

  describe('getSeating', () => {
    it('warns when the seat map is smaller than ticket quantities', async () => {
      events.getEvent.mockResolvedValue(eventDto({ seatingMode: 'reserved' }));
      repo.findMap.mockResolvedValue(seatMapRow({ totalSeats: 10 }));
      tickets.totalQuantity.mockResolvedValue(50);
      const res = await service.getSeating(actor, eventId);
      expect(res.seatShortfall).toEqual({ totalSeats: 10, ticketQuantity: 50 });
    });

    it('offers no seating for an online event and explains the join link', async () => {
      events.getEvent.mockResolvedValue(eventDto({ isOnline: true }));
      const res = await service.getSeating(actor, eventId);
      expect(res.isOnline).toBe(true);
      expect(res.seatMap).toBeNull();
      expect(res.note).toMatch(/join link/i);
      expect(repo.findMap).not.toHaveBeenCalled();
    });
  });
});
