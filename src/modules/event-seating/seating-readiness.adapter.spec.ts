import { EventSeatingPolicy } from './event-seating.policy';
import { EventSeatingRepository } from './event-seating.repository';
import { TicketQuantityPort } from './ports/ticket-quantity.port';
import { SeatingReadinessAdapter } from './seating-readiness.adapter';

describe('SeatingReadinessAdapter (US-EVT-05)', () => {
  let repo: jest.Mocked<EventSeatingRepository>;
  let tiers: jest.Mocked<TicketQuantityPort>;
  let adapter: SeatingReadinessAdapter;

  beforeEach(() => {
    repo = {
      findMap: jest.fn().mockResolvedValue({ id: 5 }),
      rowTypeCounts: jest.fn().mockResolvedValue([
        { rowLabel: '1', ticketTypeId: 'vip', seats: 16 },
        { rowLabel: '2', ticketTypeId: null, seats: 16 },
      ]),
    } as unknown as jest.Mocked<EventSeatingRepository>;
    tiers = {
      liveTiers: jest.fn().mockResolvedValue([
        { id: 'vip', name: 'VIP' },
        { id: 'free', name: 'Free' },
      ]),
    } as unknown as jest.Mocked<TicketQuantityPort>;
    adapter = new SeatingReadinessAdapter(
      repo,
      tiers,
      new EventSeatingPolicy(),
    );
  });

  it("reads the map's rows against the event's live ticket types", async () => {
    await expect(adapter.seatRowsReadiness(1, 'e1')).resolves.toEqual({
      rowsWithoutType: 1,
      ticketTypesWithoutRows: ['Free'],
    });
    expect(repo.rowTypeCounts).toHaveBeenCalledWith(1, 5);
    expect(tiers.liveTiers).toHaveBeenCalledWith(1, 'e1');
  });

  it('has no rows to read when there is no map yet', async () => {
    repo.findMap.mockResolvedValue(null);
    const readiness = await adapter.seatRowsReadiness(1, 'e1');
    expect(readiness).toEqual({
      rowsWithoutType: 0,
      ticketTypesWithoutRows: ['VIP', 'Free'],
    });
    expect(repo.rowTypeCounts).not.toHaveBeenCalled();
  });
});
