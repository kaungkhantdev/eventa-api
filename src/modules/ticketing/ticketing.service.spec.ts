import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import { EventsService } from '../events/events.service';
import { TicketingPolicy } from './ticketing.policy';
import { TicketingRepository } from './ticketing.repository';
import { TicketingService } from './ticketing.service';
import type { TicketRow } from './ticketing.types';

const actor = { organizationId: 1, userId: 'u1' };
const eventId = 'e1';
const NOW = new Date('2026-06-01T00:00:00Z');
const FUTURE = new Date('2026-07-01T00:00:00Z');
const PAST = new Date('2026-05-01T00:00:00Z');

function ticketRow(o: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 't1',
    organizationId: 1,
    eventId: 'e1',
    name: 'VIP',
    isFree: false,
    priceSatang: 89000,
    currency: 'THB',
    status: 'scheduled',
    admissionType: 'general_admission',
    sold: 0,
    total: 100,
    salesStartAt: null,
    salesEndAt: null,
    minPerOrder: 1,
    maxPerOrder: 8,
    iconClass: null,
    includes: null,
    isRecommended: false,
    badge: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    ...o,
  };
}

describe('TicketingService', () => {
  let repo: jest.Mocked<TicketingRepository>;
  let events: jest.Mocked<EventsService>;
  let service: TicketingService;

  beforeEach(() => {
    repo = {
      nameExists: jest.fn().mockResolvedValue(false),
      insert: jest
        .fn()
        .mockImplementation((v: Partial<TicketRow>) =>
          Promise.resolve(ticketRow(v)),
        ),
      listByEvent: jest.fn().mockResolvedValue([]),
      findTicket: jest.fn(),
      update: jest
        .fn()
        .mockImplementation((_o: number, _id: string, v: Partial<TicketRow>) =>
          Promise.resolve(ticketRow({ ...v, version: 2 })),
        ),
      softDelete: jest.fn().mockResolvedValue(true),
      countActive: jest.fn().mockResolvedValue(2),
      orgVatRate: jest.fn().mockResolvedValue(0.07),
    } as unknown as jest.Mocked<TicketingRepository>;
    events = {
      getEvent: jest.fn().mockResolvedValue({ id: eventId }),
    } as unknown as jest.Mocked<EventsService>;
    const clock: Clock = { now: () => NOW };
    service = new TicketingService(repo, events, new TicketingPolicy(), clock);
  });

  describe('createTicket', () => {
    it('verifies the event belongs to the org (via EventsService)', async () => {
      await service.createTicket(actor, eventId, {
        name: 'VIP',
        priceSatang: 89000,
        total: 100,
      });
      expect(events.getEvent).toHaveBeenCalledWith(actor, eventId);
    });

    it('rejects a duplicate tier name with 409', async () => {
      repo.nameExists.mockResolvedValue(true);
      const err = await service
        .createTicket(actor, eventId, { name: 'VIP' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('forces price to 0 for a free ticket', async () => {
      await service.createTicket(actor, eventId, {
        name: 'Free',
        isFree: true,
        priceSatang: 5000,
        total: 50,
      });
      expect(repo.insert.mock.calls[0][0].priceSatang).toBe(0);
    });

    it('returns the VAT-inclusive breakdown', async () => {
      const res = await service.createTicket(actor, eventId, {
        name: 'VIP',
        priceSatang: 89000,
        total: 100,
      });
      expect(res).toMatchObject({
        priceSatang: 89000,
        netSatang: 83178,
        vatSatang: 5822,
      });
    });

    it('US-TKT-01: a future sales start saves as Scheduled, not on sale', async () => {
      await service.createTicket(actor, eventId, {
        name: 'Early bird',
        priceSatang: 50000,
        total: 100,
        salesStartAt: FUTURE,
      });
      expect(repo.insert.mock.calls[0][0].status).toBe('scheduled');
    });

    it('US-TKT-01: an already-open window with seats left saves as On sale', async () => {
      await service.createTicket(actor, eventId, {
        name: 'General',
        priceSatang: 50000,
        total: 100,
        salesStartAt: PAST,
      });
      expect(repo.insert.mock.calls[0][0].status).toBe('onsale');
    });

    it('US-TKT-01: availability is derived, never taken from the client', async () => {
      await service.createTicket(actor, eventId, {
        name: 'Sneaky',
        priceSatang: 50000,
        total: 100,
        salesStartAt: FUTURE,
        status: 'onsale', // a client cannot force a scheduled tier on sale
      });
      expect(repo.insert.mock.calls[0][0].status).toBe('scheduled');
    });

    it('US-TKT-01: refuses a sales end before the start', async () => {
      const err = await service
        .createTicket(actor, eventId, {
          name: 'Backwards',
          total: 10,
          salesStartAt: FUTURE,
          salesEndAt: PAST,
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('US-TKT-01: refuses a per-order limit above the quantity available', async () => {
      const err = await service
        .createTicket(actor, eventId, {
          name: 'Too generous',
          total: 5,
          maxPerOrder: 8,
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('US-TKT-01: refuses a price that is not whole baht', async () => {
      const err = await service
        .createTicket(actor, eventId, { name: 'Odd', priceSatang: 89050 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
    });
  });

  describe('updateTicket', () => {
    beforeEach(() => {
      repo.findTicket.mockResolvedValue(
        ticketRow({ sold: 10, total: 100, version: 1 }),
      );
    });

    it('throws 404 when the ticket is not on the event', async () => {
      repo.findTicket.mockResolvedValue(null);
      const err = await service
        .updateTicket(actor, eventId, 'missing', { name: 'X' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });

    it('rejects lowering total below already-sold (422)', async () => {
      const err = await service
        .updateTicket(actor, eventId, 't1', { total: 5 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects a stale version (409)', async () => {
      const err = await service
        .updateTicket(actor, eventId, 't1', { name: 'X', version: 99 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
    });

    it('updates and returns the ticket', async () => {
      const res = await service.updateTicket(actor, eventId, 't1', {
        name: 'VVIP',
        total: 200,
      });
      expect(repo.update).toHaveBeenCalled();
      expect(res).toMatchObject({ name: 'VVIP' });
    });

    it('US-TKT-02: refuses a price change once tickets have sold (409)', async () => {
      const err = await service
        .updateTicket(actor, eventId, 't1', { priceSatang: 50000 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect((err as DomainException).message).toMatch(/new ticket type/i);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('US-TKT-02: refuses switching paid/free once tickets have sold', async () => {
      const err = await service
        .updateTicket(actor, eventId, 't1', { isFree: true })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
    });

    it('US-TKT-02: accepts a price change while nothing has sold', async () => {
      repo.findTicket.mockResolvedValue(ticketRow({ sold: 0, version: 1 }));
      await service.updateTicket(actor, eventId, 't1', { priceSatang: 50000 });
      expect(repo.update.mock.calls[0][2].priceSatang).toBe(50000);
    });

    it('US-TKT-02: raising capacity on a sold-out tier puts it back On sale', async () => {
      repo.findTicket.mockResolvedValue(
        ticketRow({ status: 'soldout', sold: 100, total: 100, version: 1 }),
      );
      await service.updateTicket(actor, eventId, 't1', { total: 150 });
      expect(repo.update.mock.calls[0][2].status).toBe('onsale');
    });

    it('US-TKT-02: a tier that sells its last seat becomes Sold out', async () => {
      repo.findTicket.mockResolvedValue(
        ticketRow({ status: 'onsale', sold: 100, total: 200, version: 1 }),
      );
      await service.updateTicket(actor, eventId, 't1', { total: 100 });
      expect(repo.update.mock.calls[0][2].status).toBe('soldout');
    });

    it('US-TKT-02: a paused tier stays paused through an unrelated edit', async () => {
      repo.findTicket.mockResolvedValue(
        ticketRow({ status: 'paused', sold: 10, total: 100, version: 1 }),
      );
      await service.updateTicket(actor, eventId, 't1', { name: 'VVIP' });
      expect(repo.update.mock.calls[0][2].status).toBe('paused');
    });
  });

  describe('deleteTicket', () => {
    it('refuses to remove a tier that has sales (409 — close it instead)', async () => {
      repo.findTicket.mockResolvedValue(ticketRow({ sold: 3 }));
      repo.countActive.mockResolvedValue(3);
      const err = await service
        .deleteTicket(actor, eventId, 't1')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect((err as DomainException).message).toMatch(/sales/i);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('refuses to remove the last remaining tier (422)', async () => {
      repo.findTicket.mockResolvedValue(ticketRow());
      repo.countActive.mockResolvedValue(1);
      const err = await service
        .deleteTicket(actor, eventId, 't1')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletes when other tiers remain', async () => {
      repo.findTicket.mockResolvedValue(ticketRow());
      repo.countActive.mockResolvedValue(3);
      await service.deleteTicket(actor, eventId, 't1');
      expect(repo.softDelete).toHaveBeenCalledWith(1, 't1');
    });
  });
});
