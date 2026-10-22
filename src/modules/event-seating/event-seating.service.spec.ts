import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { EventResponseDto } from '../events/dto/event-response.dto';
import { EventsService } from '../events/events.service';
import { TicketAvailabilityPort } from '../events/ports/ticket-availability.port';
import { EventSeatingPolicy } from './event-seating.policy';
import { EventSeatingRepository } from './event-seating.repository';
import { EventSeatingService } from './event-seating.service';
import type {
  ReservedPlanner,
  ReservedSnapshot,
  SeatMapRow,
  SeatRow,
} from './event-seating.types';

const actor = { organizationId: 1, userId: 'u1' };
const eventId = 'e1';
const NOW = new Date('2026-06-01T00:00:00Z');
const VIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const NORMAL = 'aaaaaaaa-0000-4000-8000-000000000002';
const FREE = 'aaaaaaaa-0000-4000-8000-000000000003';

const seat = (
  rowLabel: string,
  seatNumber: string,
  ticketTypeId: string | null,
) => ({ rowLabel, seatNumber, ticketTypeId });

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

function snapshot(o: Partial<ReservedSnapshot> = {}): ReservedSnapshot {
  return {
    seats: [],
    tiers: [
      { id: VIP, name: 'VIP' },
      { id: NORMAL, name: 'Normal' },
    ],
    occupiedSeatIds: new Set(),
    ...o,
  };
}

describe('EventSeatingService', () => {
  let repo: jest.Mocked<EventSeatingRepository>;
  let events: jest.Mocked<EventsService>;
  let tickets: jest.Mocked<TicketAvailabilityPort>;
  let service: EventSeatingService;

  /** The planner the service handed the repository's save. */
  const planner = (): ReservedPlanner => repo.applyReserved.mock.calls[0][2];

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
          Promise.resolve(
            seatMapRow({
              eventId: p.eventId,
              name: p.name,
              layout: { rows: p.rows, seatsPerRow: p.seatsPerRow },
              totalSeats: p.rows * p.seatsPerRow,
            }),
          ),
      ),
      seatTypes: jest.fn().mockResolvedValue([]),
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
    const clock: Clock = { now: () => NOW };
    service = new EventSeatingService(
      repo,
      events,
      tickets,
      new EventSeatingPolicy(),
      clock,
    );
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

    it('refuses a row list that is not one entry per row (422) before saving', async () => {
      const err = await service
        .configureReserved(actor, eventId, {
          name: 'Hall',
          rows: 3,
          seatsPerRow: 2,
          rowTicketTypes: [VIP, NORMAL],
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.applyReserved).not.toHaveBeenCalled();
    });

    it('refuses rows and seats sent together (422) before saving', async () => {
      const err = await service
        .configureReserved(actor, eventId, {
          name: 'Hall',
          rows: 1,
          seatsPerRow: 2,
          rowTicketTypes: [VIP],
          seatTicketTypes: [[VIP, VIP]],
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect((err as DomainException).message).toBe(
        'Send rowTicketTypes or seatTicketTypes, not both.',
      );
      expect(repo.applyReserved).not.toHaveBeenCalled();
    });

    it('refuses a seat list that is not one entry per seat (422) before saving', async () => {
      const err = await service
        .configureReserved(actor, eventId, {
          name: 'Hall',
          rows: 1,
          seatsPerRow: 3,
          seatTicketTypes: [[VIP, VIP]],
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.applyReserved).not.toHaveBeenCalled();
    });

    it('saves each seat on the ticket type sent for it', async () => {
      await service.configureReserved(actor, eventId, {
        name: 'Hall',
        rows: 1,
        seatsPerRow: 3,
        seatTicketTypes: [[FREE, NORMAL, NORMAL]],
      });
      const plan = planner()(
        snapshot({
          tiers: [
            { id: NORMAL, name: 'Normal' },
            { id: FREE, name: 'Free' },
          ],
        }),
      );
      expect(plan.added.map((s) => s.ticketTypeId)).toEqual([
        FREE,
        NORMAL,
        NORMAL,
      ]);
      expect(plan.seatsByTier).toEqual(
        new Map([
          [NORMAL, 2],
          [FREE, 1],
        ]),
      );
    });

    it('saves rows × seats with each row on its ticket type, then switches the mode', async () => {
      const res = await service.configureReserved(actor, eventId, {
        name: 'Grand Hall',
        rows: 2,
        seatsPerRow: 3,
        rowTicketTypes: [VIP, NORMAL],
      });
      const [org, params, , now] = repo.applyReserved.mock.calls[0];
      expect(org).toBe(1);
      expect(params).toEqual({
        eventId,
        name: 'Grand Hall',
        rows: 2,
        seatsPerRow: 3,
      });
      expect(now).toBe(NOW);
      const plan = planner()(snapshot());
      expect(plan.added).toHaveLength(6);
      expect(plan.added[5]).toMatchObject({
        rowLabel: '2',
        ticketTypeId: NORMAL,
      });
      expect(plan.seatsByTier).toEqual(
        new Map([
          [VIP, 3],
          [NORMAL, 3],
        ]),
      );
      expect(events.updateEvent).toHaveBeenCalledWith(actor, eventId, {
        seatingMode: 'reserved',
      });
      expect(res.seatMap?.totalSeats).toBe(6);
    });

    it('guards sold seats only once the event is published', async () => {
      const soldOutsideGrid = [
        seatRow({ id: 9, rowLabel: '3', seatNumber: '1', status: 'sold' }),
      ];
      const input = { name: 'Hall', rows: 2, seatsPerRow: 3 };
      await service.configureReserved(actor, eventId, input);
      expect(() =>
        planner()(snapshot({ seats: soldOutsideGrid })),
      ).not.toThrow();

      repo.applyReserved.mockClear();
      events.getEvent.mockResolvedValue(eventDto({ status: 'upcoming' }));
      await service.configureReserved(actor, eventId, input);
      expect(() => planner()(snapshot({ seats: soldOutsideGrid }))).toThrow(
        'Seats that are already sold cannot be removed from a published event.',
      );
    });

    it('keeps the mode when the save is refused', async () => {
      repo.applyReserved.mockRejectedValue(
        DomainException.conflict(
          "Row 2 seat 1 is booked or held, so its ticket type can't change.",
        ),
      );
      const err = await service
        .configureReserved(actor, eventId, {
          name: 'Hall',
          rows: 2,
          seatsPerRow: 3,
          rowTicketTypes: [VIP, VIP],
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(events.updateEvent).not.toHaveBeenCalled();
    });

    it("answers with every row, each seat's ticket type, and the rows and seats still untyped", async () => {
      repo.seatTypes.mockResolvedValue([
        seat('2', '1', FREE),
        seat('2', '2', null),
        seat('2', '3', null),
        seat('1', '1', VIP),
        seat('1', '2', VIP),
        seat('1', '3', VIP),
      ]);
      const res = await service.configureReserved(actor, eventId, {
        name: 'Hall',
        rows: 2,
        seatsPerRow: 3,
        seatTicketTypes: [
          [VIP, VIP, VIP],
          [FREE, null, null],
        ],
      });
      expect(repo.seatTypes).toHaveBeenCalledWith(1, 5);
      expect(res.rows).toEqual([
        {
          rowLabel: '1',
          ticketTypeId: VIP,
          seats: 3,
          seatTicketTypes: [VIP, VIP, VIP],
        },
        {
          rowLabel: '2',
          ticketTypeId: null,
          seats: 3,
          seatTicketTypes: [FREE, null, null],
        },
      ]);
      expect(res.unassignedRows).toBe(1);
      expect(res.unassignedSeats).toBe(2);
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
      expect(res.rows).toEqual([]);
      expect(res.unassignedRows).toBe(0);
      expect(res.unassignedSeats).toBe(0);
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

    it("reads each row's ticket type back in row order", async () => {
      events.getEvent.mockResolvedValue(eventDto({ seatingMode: 'reserved' }));
      repo.findMap.mockResolvedValue(seatMapRow());
      repo.seatTypes.mockResolvedValue([
        seat('10', '1', NORMAL),
        seat('2', '1', VIP),
      ]);
      const res = await service.getSeating(actor, eventId);
      expect(res.rows.map((r) => r.rowLabel)).toEqual(['2', '10']);
      expect(res.unassignedRows).toBe(0);
      expect(res.unassignedSeats).toBe(0);
    });

    it('offers no seating for an online event and explains the join link', async () => {
      events.getEvent.mockResolvedValue(eventDto({ isOnline: true }));
      const res = await service.getSeating(actor, eventId);
      expect(res.isOnline).toBe(true);
      expect(res.seatMap).toBeNull();
      expect(res.rows).toEqual([]);
      expect(res.unassignedRows).toBe(0);
      expect(res.unassignedSeats).toBe(0);
      expect(res.note).toMatch(/join link/i);
      expect(repo.findMap).not.toHaveBeenCalled();
    });
  });

  describe('cloneForEvent', () => {
    it("copies the source's grid with no ticket types on its rows", async () => {
      repo.findMap.mockResolvedValue(
        seatMapRow({ layout: { rows: 2, seatsPerRow: 2 } }),
      );
      await service.cloneForEvent(actor, 'src', 'dest');
      const [, params] = repo.applyReserved.mock.calls[0];
      expect(params).toMatchObject({
        eventId: 'dest',
        rows: 2,
        seatsPerRow: 2,
      });
      const plan = planner()(snapshot());
      expect(plan.added).toHaveLength(4);
      expect(plan.seatsByTier).toBeNull();
    });
  });
});
