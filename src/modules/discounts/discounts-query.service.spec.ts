import type { Clock } from '../../common/time/clock';
import type { EventLookupPort } from '../ticketing/ports/event-lookup.port';
import { DiscountsPolicy } from './discounts.policy';
import { DiscountsQueryService } from './discounts-query.service';
import type { DiscountsRepository } from './discounts.repository';
import type {
  DiscountRow,
  DiscountStatus,
  SearchDiscountsOptions,
} from './discounts.types';

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

/**
 * Stands in for the table: `search` filters on the STORED status, exactly as
 * the SQL does, so a code whose status has drifted is only found under its
 * real tab once that drift has been written back.
 */
function fakeRepository(rows: DiscountRow[]): DiscountsRepository {
  const stored = new Map(rows.map((r) => [r.id, { ...r }]));
  const fake = {
    liveCodes: jest.fn(() =>
      Promise.resolve([...stored.values()].filter((r) => !r.deletedAt)),
    ),
    syncStatuses: jest.fn(
      (_org: number, changes: { id: string; status: DiscountStatus }[]) => {
        for (const c of changes) stored.get(c.id)!.status = c.status;
        return Promise.resolve();
      },
    ),
    search: jest.fn((_org: number, opts: SearchDiscountsOptions) => {
      const items = [...stored.values()].filter(
        (r) => !r.deletedAt && (!opts.status || r.status === opts.status),
      );
      return Promise.resolve({ items, total: items.length });
    }),
  };
  return fake as unknown as DiscountsRepository;
}

describe('DiscountsQueryService (US-TKT-12)', () => {
  const clock: Clock = { now: () => NOW };
  const events = {
    briefsByIds: jest.fn().mockResolvedValue(new Map()),
    idsMatchingName: jest.fn().mockResolvedValue([]),
  } as unknown as EventLookupPort;

  const listCodes = async (repo: DiscountsRepository, status: DiscountStatus) =>
    (
      await new DiscountsQueryService(
        repo,
        new DiscountsPolicy(),
        events,
        clock,
      ).list(actor, { status })
    ).items.map((i) => i.code);

  describe('filtering by status narrows to each code’s current status', () => {
    it('finds a code under Active once its start date has passed', async () => {
      const repo = fakeRepository([
        discountRow({ code: 'NOWLIVE', status: 'scheduled', validFrom: PAST }),
      ]);
      expect(await listCodes(repo, 'active')).toEqual(['NOWLIVE']);
      expect(await listCodes(repo, 'scheduled')).toEqual([]);
    });

    it('finds a code under Expired once its end date has passed', async () => {
      const repo = fakeRepository([
        discountRow({ code: 'ENDED', status: 'active', validUntil: PAST }),
      ]);
      expect(await listCodes(repo, 'expired')).toEqual(['ENDED']);
      expect(await listCodes(repo, 'active')).toEqual([]);
    });

    it('leaves a code that has not drifted, and a disabled one, where they are', async () => {
      const repo = fakeRepository([
        discountRow({
          id: 'd1',
          code: 'LATER',
          status: 'scheduled',
          validFrom: FUTURE,
        }),
        discountRow({
          id: 'd2',
          code: 'OFF',
          status: 'disabled',
          validUntil: PAST,
        }),
      ]);
      expect(await listCodes(repo, 'scheduled')).toEqual(['LATER']);
      expect(await listCodes(repo, 'disabled')).toEqual(['OFF']);
    });
  });
});
