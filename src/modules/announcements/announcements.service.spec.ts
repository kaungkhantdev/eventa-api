import type { Clock } from '../../common/time/clock';
import { EVENTS_ATTENDEES_EMAIL_REQUESTED } from '../events/events/attendees-email-requested.event';
import type { AnnouncementsRepository } from './announcements.repository';
import { AnnouncementsService } from './announcements.service';
import { organizerAuth } from '../../../test/support/auth-context';

const NOW = new Date('2026-07-31T09:00:00.000Z');
const auth = organizerAuth();

const send = {
  eventId: 'e1',
  subject: 'Doors at 6',
  body: 'See you there',
  recipientCount: 42,
  sentByUserId: 'u1',
};

describe('AnnouncementsService (US-MSG-04)', () => {
  let repo: jest.Mocked<AnnouncementsRepository>;
  let service: AnnouncementsService;

  beforeEach(() => {
    repo = {
      record: jest.fn().mockResolvedValue({ id: 7 }),
      list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    } as unknown as jest.Mocked<AnnouncementsRepository>;
    const clock: Clock = { now: () => NOW };
    service = new AnnouncementsService(repo, clock);
  });

  describe('sending', () => {
    it('records the announcement and hands the repository its send', async () => {
      // One call, so the row and the outbox event commit together. Two calls
      // would mean a broadcast that reached people with nothing to show for it,
      // or a record of a message nobody ever got.
      await service.send(auth.organizationId, send);

      expect(repo.record).toHaveBeenCalledTimes(1);
      const [orgId, row, outboxEvent] = repo.record.mock.calls[0];
      expect(orgId).toBe(1);
      expect(row).toMatchObject({ subject: 'Doors at 6', recipientCount: 42 });
      expect(outboxEvent.routingKey).toBe(EVENTS_ATTENDEES_EMAIL_REQUESTED);
    });

    it('stamps the record and the send from ONE clock reading', async () => {
      // Two readings would let a record claim a different instant from the
      // message it enqueued, which is exactly what a history is for.
      await service.send(auth.organizationId, send);

      const [, row, outboxEvent] = repo.record.mock.calls[0];
      expect(row.sentAt).toEqual(NOW);
      expect(outboxEvent.payload.occurredAt).toBe(NOW.toISOString());
    });

    it('puts no recipient address on the bus', async () => {
      // The worker resolves the current attendees at send time. Carrying
      // addresses here would put attendee PII through a message broker and go
      // stale the moment somebody cancels.
      await service.send(auth.organizationId, send);

      const [, , outboxEvent] = repo.record.mock.calls[0];
      expect(JSON.stringify(outboxEvent.payload)).not.toMatch(/@/);
    });

    it('carries the body through as the message the worker will send', async () => {
      await service.send(auth.organizationId, send);

      const [, , outboxEvent] = repo.record.mock.calls[0];
      expect(outboxEvent.payload).toMatchObject({
        subject: 'Doors at 6',
        message: 'See you there',
        recipientCount: 42,
        requestedByUserId: 'u1',
      });
    });
  });

  describe('the history', () => {
    it('reads the first page when nothing is asked for', async () => {
      await service.list(auth, {});

      expect(repo.list).toHaveBeenCalledWith(1, {
        eventId: undefined,
        page: 1,
        limit: 20,
      });
    });

    it('passes the event filter through rather than filtering after the fact', async () => {
      // The list is paged by the database; narrowing it here would leave the
      // count disagreeing with the rows.
      await service.list(auth, { eventId: 'e1', page: 3, limit: 50 });

      expect(repo.list).toHaveBeenCalledWith(1, {
        eventId: 'e1',
        page: 3,
        limit: 50,
      });
    });
  });
});
