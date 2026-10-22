import { EventSeatingPolicy } from './event-seating.policy';
import { EventSeatingRepository } from './event-seating.repository';
import { TicketQuantityPort } from './ports/ticket-quantity.port';
import { SeatingReadinessAdapter } from './seating-readiness.adapter';

const seat = (
  rowLabel: string,
  seatNumber: string,
  ticketTypeId: string | null,
) => ({ rowLabel, seatNumber, ticketTypeId });

describe('SeatingReadinessAdapter (US-EVT-05)', () => {
  let repo: jest.Mocked<EventSeatingRepository>;
  let tiers: jest.Mocked<TicketQuantityPort>;
  let adapter: SeatingReadinessAdapter;

  beforeEach(() => {
    repo = {
      findMap: jest.fn().mockResolvedValue({ id: 5 }),
      seatTypes: jest
        .fn()
        .mockResolvedValue([
          seat('1', '1', 'vip'),
          seat('1', '2', 'vip'),
          seat('2', '1', 'vip'),
          seat('2', '2', null),
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

  it("reads the map's seats against the event's live ticket types", async () => {
    await expect(adapter.seatsReadiness(1, 'e1')).resolves.toEqual({
      seatsWithoutType: 1,
      ticketTypesWithoutSeats: ['Free'],
    });
    expect(repo.seatTypes).toHaveBeenCalledWith(1, 5);
    expect(tiers.liveTiers).toHaveBeenCalledWith(1, 'e1');
  });

  it('has no seats to read when there is no map yet', async () => {
    repo.findMap.mockResolvedValue(null);
    const readiness = await adapter.seatsReadiness(1, 'e1');
    expect(readiness).toEqual({
      seatsWithoutType: 0,
      ticketTypesWithoutSeats: ['VIP', 'Free'],
    });
    expect(repo.seatTypes).not.toHaveBeenCalled();
  });
});
