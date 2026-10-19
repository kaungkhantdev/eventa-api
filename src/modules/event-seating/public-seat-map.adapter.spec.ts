import { EventSeatingRepository } from './event-seating.repository';
import { PublicSeatMapAdapter } from './public-seat-map.adapter';

const VIP = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('PublicSeatMapAdapter (US-PAGE-05)', () => {
  let repo: jest.Mocked<EventSeatingRepository>;
  let adapter: PublicSeatMapAdapter;

  beforeEach(() => {
    repo = {
      findMap: jest
        .fn()
        .mockResolvedValue({ id: 5, layout: { rows: 2, seatsPerRow: 8 } }),
      rowTypeCounts: jest.fn().mockResolvedValue([
        { rowLabel: '2', ticketTypeId: null, seats: 8 },
        { rowLabel: '1', ticketTypeId: VIP, seats: 8 },
      ]),
    } as unknown as jest.Mocked<EventSeatingRepository>;
    adapter = new PublicSeatMapAdapter(repo);
  });

  it("reads the event's own map, scoped to its organization, rows in order", async () => {
    await expect(adapter.typedSeatMap(1, 'e1')).resolves.toEqual({
      seatsPerRow: 8,
      rows: [
        { label: '1', ticketTypeId: VIP },
        { label: '2', ticketTypeId: null },
      ],
    });
    expect(repo.findMap).toHaveBeenCalledWith(1, 'e1');
    expect(repo.rowTypeCounts).toHaveBeenCalledWith(1, 5);
  });

  it('is null when the event has no seat map, without reading seats', async () => {
    repo.findMap.mockResolvedValue(null);
    await expect(adapter.typedSeatMap(1, 'e1')).resolves.toBeNull();
    expect(repo.rowTypeCounts).not.toHaveBeenCalled();
  });

  it('is null when none of its rows has a ticket type', async () => {
    repo.rowTypeCounts.mockResolvedValue([
      { rowLabel: '1', ticketTypeId: null, seats: 8 },
    ]);
    await expect(adapter.typedSeatMap(1, 'e1')).resolves.toBeNull();
  });
});
