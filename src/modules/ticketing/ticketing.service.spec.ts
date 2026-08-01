import { DomainException } from '../../common/errors/domain.exception';
import { EventsService } from '../events/events.service';
import { TicketingRepository } from './ticketing.repository';
import { TicketingService } from './ticketing.service';
import type { TicketRow } from './ticketing.types';

const actor = { organizationId: 1, userId: 'u1' };
const eventId = 'e1';

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
    service = new TicketingService(repo, events);
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
