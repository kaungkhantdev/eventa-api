import { EventSeatingRepository } from './event-seating.repository';
import { PublicSeatMapAdapter } from './public-seat-map.adapter';

const VIP = 'aaaaaaaa-0000-4000-8000-000000000001';
const FREE = 'aaaaaaaa-0000-4000-8000-000000000003';

const seat = (
  rowLabel: string,
  seatNumber: string,
  ticketTypeId: string | null,
) => ({ rowLabel, seatNumber, ticketTypeId });

describe('PublicSeatMapAdapter (US-PAGE-05)', () => {
  let repo: jest.Mocked<EventSeatingRepository>;
  let adapter: PublicSeatMapAdapter;

  beforeEach(() => {
    repo = {
      findMap: jest
        .fn()
        .mockResolvedValue({ id: 5, layout: { rows: 2, seatsPerRow: 2 } }),
      seatTypes: jest
        .fn()
        .mockResolvedValue([
          seat('2', '2', null),
          seat('2', '1', FREE),
          seat('1', '1', VIP),
          seat('1', '2', VIP),
        ]),
    } as unknown as jest.Mocked<EventSeatingRepository>;
    adapter = new PublicSeatMapAdapter(repo);
  });

  it("reads the event's own map, scoped to its organization, rows and seats in order", async () => {
    await expect(adapter.typedSeatMap(1, 'e1')).resolves.toEqual({
      seatsPerRow: 2,
      rows: [
        { label: '1', ticketTypeId: VIP, seatTicketTypes: [VIP, VIP] },
        { label: '2', ticketTypeId: null, seatTicketTypes: [FREE, null] },
      ],
    });
    expect(repo.findMap).toHaveBeenCalledWith(1, 'e1');
    expect(repo.seatTypes).toHaveBeenCalledWith(1, 5);
  });

  it('is null when the event has no seat map, without reading seats', async () => {
    repo.findMap.mockResolvedValue(null);
    await expect(adapter.typedSeatMap(1, 'e1')).resolves.toBeNull();
    expect(repo.seatTypes).not.toHaveBeenCalled();
  });

  it('is null when none of its seats has a ticket type', async () => {
    repo.seatTypes.mockResolvedValue([seat('1', '1', null)]);
    await expect(adapter.typedSeatMap(1, 'e1')).resolves.toBeNull();
  });
});
