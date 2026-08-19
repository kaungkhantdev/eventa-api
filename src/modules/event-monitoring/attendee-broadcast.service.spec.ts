import type { Clock } from '../../common/time/clock';
import type { OutboxPort } from '../platform/outbox.port';
import { DomainException } from '../../common/errors/domain.exception';
import type { EventsService } from '../events/events.service';
import type { EventStatsPort } from '../events/ports/event-stats.port';
import { AttendeeBroadcastService } from './attendee-broadcast.service';
import { EVENTS_ATTENDEES_EMAIL_REQUESTED } from '../events/events/attendees-email-requested.event';

const actor = { organizationId: 1, userId: 'u1' };
const NOW = new Date('2026-07-31T00:00:00.000Z');
const input = {
  subject: 'Doors at 6',
  message: 'See you there',
  confirm: true,
};

describe('AttendeeBroadcastService', () => {
  let events: jest.Mocked<EventsService>;
  let stats: jest.Mocked<EventStatsPort>;
  let outbox: jest.Mocked<OutboxPort>;
  let service: AttendeeBroadcastService;

  beforeEach(() => {
    events = {
      getEvent: jest.fn().mockResolvedValue({ id: 'e1' }),
    } as unknown as jest.Mocked<EventsService>;
    stats = {
      attendeeCount: jest.fn().mockResolvedValue(42),
    } as unknown as jest.Mocked<EventStatsPort>;
    outbox = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const clock: Clock = { now: () => NOW };
    service = new AttendeeBroadcastService(events, stats, outbox, clock);
  });

  it('enqueues a broadcast outbox event and returns the recipient count', async () => {
    const res = await service.emailAll(actor, 'e1', input);

    expect(res).toEqual({ eventId: 'e1', recipients: 42, queued: true });
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    const event = outbox.enqueue.mock.calls[0][0];
    expect(event.routingKey).toBe(EVENTS_ATTENDEES_EMAIL_REQUESTED);
    expect(event.organizationId).toBe(1);
    expect(event.aggregateId).toBe('e1');
    expect(event.payload).toMatchObject({
      version: 1,
      eventId: 'e1',
      subject: 'Doors at 6',
      message: 'See you there',
      requestedByUserId: 'u1',
      recipientCount: 42,
      occurredAt: NOW.toISOString(),
    });
  });

  it('does not embed recipient addresses in the event payload (no PII on the bus)', async () => {
    await service.emailAll(actor, 'e1', input);
    const payload = outbox.enqueue.mock.calls[0][0].payload;
    expect(JSON.stringify(payload)).not.toMatch(/@/);
  });

  it('404s (and enqueues nothing) when the event is not in the caller org', async () => {
    events.getEvent.mockRejectedValue(
      DomainException.notFound('Event not found.'),
    );
    await expect(service.emailAll(actor, 'ghost', input)).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
