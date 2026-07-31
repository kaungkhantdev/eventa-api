import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import type { Env } from '../../config/env.validation';
import { SeatHoldRepository } from './seat-hold.repository';
import { SeatHoldService } from './seat-hold.service';
import type { SeatHoldRow } from './seat-hold.types';

const actor = { organizationId: 1 };
const NOW = new Date('2026-07-31T00:00:00.000Z');
const TTL_SECONDS = 600;
const EXPECTED_EXPIRY = new Date('2026-07-31T00:10:00.000Z');

const seatHold = (id: number): SeatHoldRow =>
  ({ id, status: 'active' }) as unknown as SeatHoldRow;

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainException);
    return (err as DomainException).getStatus();
  }
  throw new Error('expected the call to throw');
}

describe('SeatHoldService', () => {
  let repo: jest.Mocked<SeatHoldRepository>;
  let service: SeatHoldService;

  beforeEach(() => {
    repo = {
      holdSeats: jest.fn(),
      holdQuantity: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
      expireStale: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<SeatHoldRepository>;
    const clock: Clock = { now: () => NOW };
    const config = {
      getOrThrow: jest.fn().mockReturnValue(TTL_SECONDS),
    } as unknown as ConfigService<Env, true>;
    service = new SeatHoldService(repo, clock, config);
  });

  describe('holdSeats', () => {
    it('dedupes seat ids and reserves them with a TTL expiry', async () => {
      repo.holdSeats.mockResolvedValue({ ok: true, holds: [seatHold(10)] });

      const holds = await service.holdSeats(actor, {
        eventId: 'e1',
        seatIds: [5, 5, 7],
      });

      expect(repo.holdSeats).toHaveBeenCalledWith(
        1,
        'e1',
        [5, 7],
        EXPECTED_EXPIRY,
        NOW,
        undefined,
      );
      expect(holds).toHaveLength(1);
    });

    it('threads a backing order id through to the repository', async () => {
      repo.holdSeats.mockResolvedValue({ ok: true, holds: [] });
      await service.holdSeats(actor, {
        eventId: 'e1',
        seatIds: [5],
        orderId: 'o1',
      });
      expect(repo.holdSeats).toHaveBeenCalledWith(
        1,
        'e1',
        [5],
        EXPECTED_EXPIRY,
        NOW,
        'o1',
      );
    });

    it('rejects an empty selection (422)', async () => {
      expect(
        await statusOf(() =>
          service.holdSeats(actor, { eventId: 'e1', seatIds: [] }),
        ),
      ).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(repo.holdSeats).not.toHaveBeenCalled();
    });

    it('rejects more than 8 seats in one booking (422)', async () => {
      expect(
        await statusOf(() =>
          service.holdSeats(actor, {
            eventId: 'e1',
            seatIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
          }),
        ),
      ).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(repo.holdSeats).not.toHaveBeenCalled();
    });

    it('409s when a seat was just taken, surfacing the unavailable ids', async () => {
      repo.holdSeats.mockResolvedValue({
        ok: false,
        unavailableSeatIds: [7],
      });
      let caught: DomainException | undefined;
      try {
        await service.holdSeats(actor, { eventId: 'e1', seatIds: [5, 7] });
      } catch (err) {
        caught = err as DomainException;
      }
      expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(caught?.details).toEqual({ unavailableSeatIds: [7] });
    });
  });

  describe('holdQuantity', () => {
    it('reserves a GA quantity with a TTL expiry', async () => {
      repo.holdQuantity.mockResolvedValue({ ok: true, hold: seatHold(3) });

      const hold = await service.holdQuantity(actor, {
        eventId: 'e1',
        ticketTypeId: 't1',
        quantity: 4,
      });

      expect(repo.holdQuantity).toHaveBeenCalledWith(
        1,
        'e1',
        't1',
        4,
        EXPECTED_EXPIRY,
        NOW,
        undefined,
      );
      expect(hold.id).toBe(3);
    });

    it('rejects a quantity outside 1–8 (422)', async () => {
      expect(
        await statusOf(() =>
          service.holdQuantity(actor, {
            eventId: 'e1',
            ticketTypeId: 't1',
            quantity: 0,
          }),
        ),
      ).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(repo.holdQuantity).not.toHaveBeenCalled();
    });

    it('409s with the remaining count when the tier is short', async () => {
      repo.holdQuantity.mockResolvedValue({ ok: false, available: 2 });
      let caught: DomainException | undefined;
      try {
        await service.holdQuantity(actor, {
          eventId: 'e1',
          ticketTypeId: 't1',
          quantity: 5,
        });
      } catch (err) {
        caught = err as DomainException;
      }
      expect(caught?.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(caught?.details).toEqual({ available: 2 });
    });
  });

  describe('release & expireStale', () => {
    it('delegates release to the repository', async () => {
      await service.release(actor, [1, 2]);
      expect(repo.release).toHaveBeenCalledWith(1, [1, 2]);
    });

    it('expires stale holds using the clock when no time is given', async () => {
      repo.expireStale.mockResolvedValue(3);
      const count = await service.expireStale(actor);
      expect(repo.expireStale).toHaveBeenCalledWith(1, NOW);
      expect(count).toBe(3);
    });
  });
});
