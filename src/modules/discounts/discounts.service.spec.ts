import type { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import { DiscountCodeGenerator } from './discount-code.generator';
import { DiscountsPolicy } from './discounts.policy';
import type { DiscountsRepository } from './discounts.repository';
import { DiscountsService } from './discounts.service';
import type { DiscountRow } from './discounts.types';

const actor = { organizationId: 1, userId: 'u1' };
const NOW = new Date('2026-06-01T00:00:00Z');
const PAST = new Date('2026-05-01T00:00:00Z');
const FUTURE = new Date('2026-07-01T00:00:00Z');

function discountRow(o: Partial<DiscountRow> = {}): DiscountRow {
  return {
    id: 'd1',
    organizationId: 1,
    eventId: null,
    code: 'PROMO42',
    type: 'percent',
    value: 25,
    status: 'active',
    used: 0,
    redemptionLimit: 0,
    perPersonLimit: 0,
    minOrderSatang: 0,
    validFrom: null,
    validUntil: null,
    revenueAttributedSatang: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    ...o,
  };
}

describe('DiscountsService', () => {
  let repo: jest.Mocked<DiscountsRepository>;
  let service: DiscountsService;

  beforeEach(() => {
    repo = {
      insert: jest
        .fn()
        .mockImplementation((v: Partial<DiscountRow>) =>
          Promise.resolve(discountRow(v)),
        ),
      findById: jest.fn(),
      codeExists: jest.fn().mockResolvedValue(false),
      allCodes: jest.fn().mockResolvedValue(new Set<string>()),
      update: jest
        .fn()
        .mockImplementation(
          (_o: number, _id: string, v: Partial<DiscountRow>) =>
            Promise.resolve(discountRow({ ...v, version: 2 })),
        ),
      softDelete: jest.fn().mockResolvedValue(true),
      hardDelete: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<DiscountsRepository>;
    const clock: Clock = { now: () => NOW };
    service = new DiscountsService(
      repo,
      new DiscountsPolicy(),
      new DiscountCodeGenerator(),
      clock,
    );
  });

  describe('createDiscount (US-TKT-07)', () => {
    it('stores the code uppercase and starts at 0 redemptions', async () => {
      const res = await service.createDiscount(actor, {
        code: 'promo42',
        type: 'percent',
        value: 25,
      });
      expect(repo.insert.mock.calls[0][0].code).toBe('PROMO42');
      expect(res.used).toBe(0);
    });

    it('is Scheduled when it starts in the future, Active when it starts today', async () => {
      await service.createDiscount(actor, {
        code: 'LATER10',
        type: 'percent',
        value: 10,
        validFrom: FUTURE,
      });
      expect(repo.insert.mock.calls[0][0].status).toBe('scheduled');

      await service.createDiscount(actor, {
        code: 'NOW10',
        type: 'percent',
        value: 10,
        validFrom: PAST,
      });
      expect(repo.insert.mock.calls[1][0].status).toBe('active');
    });

    it('refuses a duplicate code with 409', async () => {
      repo.codeExists.mockResolvedValue(true);
      const err = await service
        .createDiscount(actor, { code: 'PROMO42', type: 'percent', value: 25 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('refuses a per-person limit above the total usage limit', async () => {
      const err = await service
        .createDiscount(actor, {
          code: 'BADLIMIT',
          type: 'percent',
          value: 10,
          redemptionLimit: 5,
          perPersonLimit: 10,
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
    });

    it('refuses a window that has already ended', async () => {
      const err = await service
        .createDiscount(actor, {
          code: 'STALE10',
          type: 'percent',
          value: 10,
          validUntil: PAST,
        })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
    });
  });

  describe('suggestCode (US-TKT-07)', () => {
    it('never proposes a code that already exists', async () => {
      repo.allCodes.mockResolvedValue(new Set(['PROMO42']));
      for (let i = 0; i < 50; i++) {
        const { code } = await service.suggestCode(actor);
        expect(code).not.toBe('PROMO42');
      }
    });
  });

  describe('updateDiscount (US-TKT-08)', () => {
    it('refuses lowering the limit below redemptions already made', async () => {
      repo.findById.mockResolvedValue(
        discountRow({ used: 342, redemptionLimit: 500 }),
      );
      const err = await service
        .updateDiscount(actor, 'd1', { redemptionLimit: 300 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('accepts a value change while it has never been redeemed', async () => {
      repo.findById.mockResolvedValue(discountRow({ used: 0 }));
      await service.updateDiscount(actor, 'd1', { value: 30 });
      expect(repo.update.mock.calls[0][2].value).toBe(30);
    });

    it('refuses changing the code text or value once redeemed', async () => {
      repo.findById.mockResolvedValue(discountRow({ used: 342 }));
      const text = await service
        .updateDiscount(actor, 'd1', { code: 'OTHER' })
        .catch((e: unknown) => e);
      expect((text as DomainException).getStatus()).toBe(409);
      const value = await service
        .updateDiscount(actor, 'd1', { value: 30 })
        .catch((e: unknown) => e);
      expect((value as DomainException).getStatus()).toBe(409);
    });

    it('allows narrowing the scope and window of a redeemed code', async () => {
      repo.findById.mockResolvedValue(discountRow({ used: 342 }));
      await service.updateDiscount(actor, 'd1', {
        eventId: 'e1',
        validUntil: FUTURE,
      });
      expect(repo.update.mock.calls[0][2].eventId).toBe('e1');
    });

    it('rejects a stale version (409)', async () => {
      repo.findById.mockResolvedValue(discountRow({ version: 3 }));
      const err = await service
        .updateDiscount(actor, 'd1', { value: 30, version: 1 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
    });
  });

  describe('disable / enable (US-TKT-09/10)', () => {
    it('switches a code off', async () => {
      repo.findById.mockResolvedValue(discountRow());
      const res = await service.disableDiscount(actor, 'd1');
      expect(res.status).toBe('disabled');
    });

    it('refuses to switch on a code whose window has passed', async () => {
      repo.findById.mockResolvedValue(
        discountRow({ status: 'disabled', validUntil: PAST }),
      );
      const err = await service
        .enableDiscount(actor, 'd1')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect((err as DomainException).message).toMatch(/dates|usage limit/i);
    });

    it('refuses to switch on a code that has used up its limit', async () => {
      repo.findById.mockResolvedValue(
        discountRow({ status: 'disabled', used: 10, redemptionLimit: 10 }),
      );
      const err = await service
        .enableDiscount(actor, 'd1')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
    });

    it('switches a still-runnable code back to active', async () => {
      repo.findById.mockResolvedValue(discountRow({ status: 'disabled' }));
      const res = await service.enableDiscount(actor, 'd1');
      expect(res.status).toBe('active');
    });
  });

  describe('deleteDiscount (US-TKT-09)', () => {
    it('removes a code that was never redeemed', async () => {
      repo.findById.mockResolvedValue(discountRow({ used: 0 }));
      expect(await service.deleteDiscount(actor, 'd1')).toEqual({
        outcome: 'removed',
      });
      expect(repo.hardDelete).toHaveBeenCalled();
    });

    it('retires a redeemed code so prior orders keep their discount', async () => {
      repo.findById.mockResolvedValue(discountRow({ used: 89 }));
      expect(await service.deleteDiscount(actor, 'd1')).toEqual({
        outcome: 'retired',
      });
      expect(repo.softDelete).toHaveBeenCalled();
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });
  });
});
