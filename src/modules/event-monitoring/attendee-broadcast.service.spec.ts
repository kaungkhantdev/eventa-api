import { DomainException } from '../../common/errors/domain.exception';
import type { AnnouncementsService } from '../announcements/announcements.service';
import type { EventsService } from '../events/events.service';
import type { EventStatsPort } from '../events/ports/event-stats.port';
import { AttendeeBroadcastService } from './attendee-broadcast.service';

const actor = { organizationId: 1, userId: 'u1' };
const input = {
  subject: 'Doors at 6',
  message: 'See you there',
  confirm: true,
};

describe('AttendeeBroadcastService', () => {
  let events: jest.Mocked<EventsService>;
  let stats: jest.Mocked<EventStatsPort>;
  let announcements: jest.Mocked<AnnouncementsService>;
  let service: AttendeeBroadcastService;

  beforeEach(() => {
    events = {
      getEvent: jest.fn().mockResolvedValue({ id: 'e1' }),
    } as unknown as jest.Mocked<EventsService>;
    stats = {
      attendeeCount: jest.fn().mockResolvedValue(42),
    } as unknown as jest.Mocked<EventStatsPort>;
    announcements = {
      send: jest.fn().mockResolvedValue({ id: 7 }),
    } as unknown as jest.Mocked<AnnouncementsService>;
    service = new AttendeeBroadcastService(events, stats, announcements);
  });

  it('hands the broadcast on with the audience it resolved, and answers with the count', async () => {
    const res = await service.emailAll(actor, 'e1', input);

    expect(res).toEqual({ eventId: 'e1', recipients: 42, queued: true });
    expect(announcements.send).toHaveBeenCalledWith(1, {
      eventId: 'e1',
      subject: 'Doors at 6',
      body: 'See you there',
      recipientCount: 42,
      sentByUserId: 'u1',
    });
  });

  it('counts the attendees for the event being written to', async () => {
    await service.emailAll(actor, 'e1', input);
    expect(stats.attendeeCount).toHaveBeenCalledWith(1, 'e1');
  });

  it('404s (and sends nothing) when the event is not in the caller org', async () => {
    events.getEvent.mockRejectedValue(
      DomainException.notFound('Event not found.'),
    );
    await expect(service.emailAll(actor, 'ghost', input)).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
    expect(announcements.send).not.toHaveBeenCalled();
  });
});
