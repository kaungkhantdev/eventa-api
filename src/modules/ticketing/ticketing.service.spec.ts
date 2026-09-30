import { Logger } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import { EventsService } from '../events/events.service';
import { CheckoutActivityPort } from './ports/checkout-activity.port';
import { WaitlistOffersPort } from './ports/waitlist-offers.port';
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

/** What the waitlist made of a raise — every offer tried, none cut short. */
const OFFERS_FINISHED = (offered: number) => ({ offered, interrupted: false });

describe('TicketingService', () => {
  let repo: jest.Mocked<TicketingRepository>;
  let events: jest.Mocked<EventsService>;
  let checkout: jest.Mocked<CheckoutActivityPort>;
  let waitlist: jest.Mocked<WaitlistOffersPort>;
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
      hardDelete: jest.fn().mockResolvedValue(true),
      countActive: jest.fn().mockResolvedValue(2),
      orgVatRate: jest.fn().mockResolvedValue(0.07),
    } as unknown as jest.Mocked<TicketingRepository>;
    checkout = {
      hasActiveHolds: jest.fn().mockResolvedValue(false),
    };
    events = {
      getEvent: jest.fn().mockResolvedValue({ id: eventId }),
    } as unknown as jest.Mocked<EventsService>;
    waitlist = {
      offerNewPlaces: jest.fn().mockResolvedValue(OFFERS_FINISHED(0)),
    };
    const clock: Clock = { now: () => NOW };
    service = new TicketingService(
      repo,
      events,
      new TicketingPolicy(),
      clock,
      checkout,
      waitlist,
    );
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

  describe('updateTicket — new places go to the waitlist (US-REG-04)', () => {
    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      repo.findTicket.mockResolvedValue(
        ticketRow({ status: 'soldout', sold: 100, total: 100, version: 1 }),
      );
    });

    afterEach(() => jest.restoreAllMocks());

    it('offers the new places to the waitlist and says how many', async () => {
      waitlist.offerNewPlaces.mockResolvedValue(OFFERS_FINISHED(2));
      const res = await service.updateTicket(actor, eventId, 't1', {
        total: 120,
      });
      expect(waitlist.offerNewPlaces).toHaveBeenCalledWith(1, 'e1', 't1');
      expect(res).toMatchObject({
        waitlistOffered: 2,
        waitlistOfferInterrupted: false,
      });
    });

    it('says when the offers were cut short, so the rest can be offered by hand', async () => {
      // The allocation is saved and on sale either way; without this the
      // organizer could not tell a failure from "the front did not fit".
      waitlist.offerNewPlaces.mockResolvedValue({
        offered: 1,
        interrupted: true,
      });
      const res = await service.updateTicket(actor, eventId, 't1', {
        total: 120,
      });
      expect(res).toMatchObject({
        waitlistOffered: 1,
        waitlistOfferInterrupted: true,
      });
    });

    it('offers only after the new allocation is saved', async () => {
      await service.updateTicket(actor, eventId, 't1', { total: 120 });
      expect(repo.update.mock.invocationCallOrder[0]).toBeLessThan(
        waitlist.offerNewPlaces.mock.invocationCallOrder[0],
      );
    });

    it('asks nobody when the edit does not raise the allocation', async () => {
      const renamed = await service.updateTicket(actor, eventId, 't1', {
        name: 'VVIP',
      });
      repo.findTicket.mockResolvedValue(
        ticketRow({ sold: 10, total: 100, version: 1 }),
      );
      const cut = await service.updateTicket(actor, eventId, 't1', {
        total: 90,
      });
      expect(waitlist.offerNewPlaces).not.toHaveBeenCalled();
      for (const res of [renamed, cut]) {
        expect(res).toMatchObject({
          waitlistOffered: 0,
          waitlistOfferInterrupted: false,
        });
      }
    });

    it('does not treat a tier leaving unlimited as new places', async () => {
      repo.findTicket.mockResolvedValue(
        ticketRow({ sold: 10, total: 0, version: 1 }),
      );
      await service.updateTicket(actor, eventId, 't1', { total: 50 });
      expect(waitlist.offerNewPlaces).not.toHaveBeenCalled();
    });

    it('keeps the capacity change, and says the offers were cut short, if the waitlist throws', async () => {
      // The port promises not to reject; were it to, the saved change must
      // not come back as a 500 — nor as a quiet "nobody offered".
      waitlist.offerNewPlaces.mockRejectedValue(new Error('broker down'));
      const res = await service.updateTicket(actor, eventId, 't1', {
        total: 120,
      });
      expect(repo.update).toHaveBeenCalled();
      expect(res).toMatchObject({
        total: 120,
        waitlistOffered: 0,
        waitlistOfferInterrupted: true,
      });
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('answers with the ticket as it stands after the offers', async () => {
      // A free place confirmed off the waitlist counts as sold.
      waitlist.offerNewPlaces.mockResolvedValue(OFFERS_FINISHED(1));
      repo.findTicket
        .mockResolvedValueOnce(
          ticketRow({ status: 'soldout', sold: 100, total: 100, version: 1 }),
        )
        .mockResolvedValueOnce(
          ticketRow({ status: 'onsale', sold: 101, total: 120, version: 2 }),
        );
      const res = await service.updateTicket(actor, eventId, 't1', {
        total: 120,
      });
      expect(repo.findTicket).toHaveBeenCalledTimes(2);
      expect(res).toMatchObject({ sold: 101, total: 120, waitlistOffered: 1 });
    });

    it('does not read the ticket again when nobody was offered a place', async () => {
      await service.updateTicket(actor, eventId, 't1', { total: 120 });
      expect(repo.findTicket).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteTicket (US-TKT-05)', () => {
    it('removes a tier that has never sold, completely', async () => {
      repo.findTicket.mockResolvedValue(ticketRow({ sold: 0 }));
      repo.countActive.mockResolvedValue(3);
      const res = await service.deleteTicket(actor, eventId, 't1');
      expect(res).toEqual({ outcome: 'removed' });
      expect(repo.hardDelete).toHaveBeenCalledWith(1, 't1');
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('retires a tier that has sold — holders keep their tickets', async () => {
      repo.findTicket.mockResolvedValue(ticketRow({ sold: 210 }));
      repo.countActive.mockResolvedValue(3);
      const res = await service.deleteTicket(actor, eventId, 't1');
      expect(res).toEqual({ outcome: 'retired' });
      // retire = soft delete: the row survives, so issued tickets keep resolving
      expect(repo.softDelete).toHaveBeenCalledWith(1, 't1');
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it('refuses while a checkout is in progress, and says what to do', async () => {
      repo.findTicket.mockResolvedValue(ticketRow({ sold: 5 }));
      repo.countActive.mockResolvedValue(3);
      checkout.hasActiveHolds.mockResolvedValue(true);
      const err = await service
        .deleteTicket(actor, eventId, 't1')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect((err as DomainException).message).toMatch(/pause/i);
      expect(repo.softDelete).not.toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it('refuses to remove the last remaining tier (422)', async () => {
      repo.findTicket.mockResolvedValue(ticketRow());
      repo.countActive.mockResolvedValue(1);
      const err = await service
        .deleteTicket(actor, eventId, 't1')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.softDelete).not.toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });
  });
});
