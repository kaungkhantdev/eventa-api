import { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import type { Tx } from '../../db/tenant';
import { TicketQuantityAdapter } from './ticket-quantity.adapter';
import { TicketingPolicy } from './ticketing.policy';
import { TicketingRepository } from './ticketing.repository';
import type { TicketRow } from './ticketing.types';

const NOW = new Date('2026-06-01T00:00:00Z');
const tx = {} as Tx;

function tier(o: Partial<TicketRow>): TicketRow {
  return {
    id: 't1',
    organizationId: 1,
    eventId: 'e1',
    name: 'VIP',
    isFree: false,
    priceSatang: 250000,
    currency: 'THB',
    status: 'onsale',
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

describe('TicketQuantityAdapter (US-EVT-05)', () => {
  let repo: jest.Mocked<TicketingRepository>;
  let adapter: TicketQuantityAdapter;

  beforeEach(() => {
    repo = {
      lockLiveByEventIn: jest.fn().mockResolvedValue([]),
      setTotalIn: jest.fn().mockResolvedValue(undefined),
      listByEvent: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<TicketingRepository>;
    const clock: Clock = { now: () => NOW };
    adapter = new TicketQuantityAdapter(repo, new TicketingPolicy(), clock);
  });

  it("locks the event's live ticket types inside the save and names them", async () => {
    repo.lockLiveByEventIn.mockResolvedValue([
      tier({ id: 'vip', name: 'VIP' }),
      tier({ id: 'normal', name: 'Normal' }),
    ]);
    await expect(adapter.lockLiveTiersIn(tx, 1, 'e1')).resolves.toEqual([
      { id: 'vip', name: 'VIP' },
      { id: 'normal', name: 'Normal' },
    ]);
    expect(repo.lockLiveByEventIn).toHaveBeenCalledWith(tx, 1, 'e1');
  });

  it("sets each type's quantity to its seats, 0 for one with no rows", async () => {
    repo.lockLiveByEventIn.mockResolvedValue([
      tier({ id: 'vip', total: 100 }),
      tier({ id: 'free', name: 'Free', total: 50 }),
    ]);
    await adapter.setSeatQuantitiesIn(tx, 1, 'e1', new Map([['vip', 32]]));
    expect(repo.setTotalIn).toHaveBeenCalledWith(tx, 1, 'vip', 32, 'onsale');
    expect(repo.setTotalIn).toHaveBeenCalledWith(tx, 1, 'free', 0, 'onsale');
  });

  it('re-derives the status the way a quantity edit does', async () => {
    repo.lockLiveByEventIn.mockResolvedValue([
      tier({ id: 'vip', total: 10, sold: 10, status: 'soldout' }),
      tier({ id: 'normal', total: 20, sold: 16, status: 'onsale' }),
      tier({ id: 'paused', total: 20, status: 'paused' }),
    ]);
    await adapter.setSeatQuantitiesIn(
      tx,
      1,
      'e1',
      new Map([
        ['vip', 16],
        ['normal', 16],
        ['paused', 8],
      ]),
    );
    expect(repo.setTotalIn).toHaveBeenCalledWith(tx, 1, 'vip', 16, 'onsale');
    expect(repo.setTotalIn).toHaveBeenCalledWith(
      tx,
      1,
      'normal',
      16,
      'soldout',
    );
    expect(repo.setTotalIn).toHaveBeenCalledWith(tx, 1, 'paused', 8, 'paused');
  });

  it('leaves a type whose seats did not change alone', async () => {
    repo.lockLiveByEventIn.mockResolvedValue([tier({ id: 'vip', total: 32 })]);
    await adapter.setSeatQuantitiesIn(tx, 1, 'e1', new Map([['vip', 32]]));
    expect(repo.setTotalIn).not.toHaveBeenCalled();
  });

  it('refuses the whole save when a type would hold fewer seats than it sold (409)', async () => {
    repo.lockLiveByEventIn.mockResolvedValue([
      tier({ id: 'vip', total: 32 }),
      tier({ id: 'normal', name: 'Normal', total: 64, sold: 60 }),
    ]);
    const err = await adapter
      .setSeatQuantitiesIn(
        tx,
        1,
        'e1',
        new Map([
          ['vip', 48],
          ['normal', 48],
        ]),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).getStatus()).toBe(409);
    expect((err as DomainException).message).toBe(
      'Normal has sold 60 tickets, more than the 48 seats it now holds.',
    );
    expect(repo.setTotalIn).not.toHaveBeenCalled();
  });

  it("lists the event's live ticket types outside a save", async () => {
    repo.listByEvent.mockResolvedValue([tier({ id: 'vip', name: 'VIP' })]);
    await expect(adapter.liveTiers(1, 'e1')).resolves.toEqual([
      { id: 'vip', name: 'VIP' },
    ]);
  });
});
