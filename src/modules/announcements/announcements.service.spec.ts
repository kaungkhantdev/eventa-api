import { HttpStatus } from '@nestjs/common';
import type { DomainException } from '../../common/errors/domain.exception';
import type { Clock } from '../../common/time/clock';
import { EVENTS_ATTENDEES_EMAIL_REQUESTED } from '../events/events/attendees-email-requested.event';
import { ALREADY_CANCELLED, ALREADY_SENT } from './announcement-schedule';
import type {
  AnnouncementListRow,
  AnnouncementsRepository,
} from './announcements.repository';
import { AnnouncementsService } from './announcements.service';
import { organizerAuth } from '../../../test/support/auth-context';

const NOW = new Date('2026-07-31T09:00:00.000Z');
const auth = organizerAuth();

const IN_A_DAY = new Date('2026-08-01T09:00:00.000Z');
const ANNOUNCEMENT_ID = 7;

const listed = (
  over: Partial<AnnouncementListRow> = {},
): AnnouncementListRow => ({
  id: String(ANNOUNCEMENT_ID),
  eventId: 'e1',
  eventName: 'Tech Summit 2026',
  subject: 'Doors at 6',
  body: 'See you there',
  status: 'scheduled',
  scheduledFor: IN_A_DAY,
  sentAt: null,
  cancelledAt: null,
  recipientCount: null,
  ...over,
});

async function refusal(work: Promise<unknown>): Promise<DomainException> {
  try {
    await work;
  } catch (err) {
    return err as DomainException;
  }
  throw new Error('expected a refusal');
}

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
      recordScheduled: jest.fn().mockResolvedValue({ id: 7 }),
      cancel: jest.fn().mockResolvedValue(listed({ status: 'cancelled' })),
      reschedule: jest.fn().mockResolvedValue(listed()),
      find: jest.fn().mockResolvedValue(null),
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

  describe('scheduling one (US-MSG-04)', () => {
    const later = {
      eventId: 'e1',
      subject: 'Doors at 6',
      body: 'See you there',
      sentByUserId: 'u1',
      sendAt: IN_A_DAY,
    };

    it('records it as scheduled for its time, and queues NOTHING', async () => {
      // Nothing may reach the outbox until the time comes — the worker writes
      // the send then. An outbox row now would email everybody immediately.
      await service.schedule(auth.organizationId, later);

      expect(repo.record).not.toHaveBeenCalled();
      expect(repo.recordScheduled).toHaveBeenCalledWith(1, {
        eventId: 'e1',
        subject: 'Doors at 6',
        body: 'See you there',
        sentByUserId: 'u1',
        scheduledFor: IN_A_DAY,
      });
    });

    it('refuses a time already past without writing anything', async () => {
      const err = await refusal(
        service.schedule(auth.organizationId, {
          ...later,
          sendAt: new Date(NOW.getTime() - 60_000),
        }),
      );

      expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(repo.recordScheduled).not.toHaveBeenCalled();
    });
  });

  describe('cancelling one (US-MSG-05)', () => {
    it('cancels it as the person asking, at one clock reading', async () => {
      const row = await service.cancel(auth, ANNOUNCEMENT_ID);

      expect(repo.cancel).toHaveBeenCalledWith(1, ANNOUNCEMENT_ID, {
        userId: 'u1',
        now: NOW,
      });
      expect(row.status).toBe('cancelled');
    });

    it('says it can no longer be changed once it has started sending', async () => {
      repo.cancel.mockResolvedValue(null);
      repo.find.mockResolvedValue(listed({ status: 'sent' }));

      const err = await refusal(service.cancel(auth, ANNOUNCEMENT_ID));

      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(err.message).toBe(ALREADY_SENT);
    });

    it('says so when it was already cancelled', async () => {
      repo.cancel.mockResolvedValue(null);
      repo.find.mockResolvedValue(listed({ status: 'cancelled' }));

      const err = await refusal(service.cancel(auth, ANNOUNCEMENT_ID));

      expect(err.message).toBe(ALREADY_CANCELLED);
    });

    it('404s one that is not the caller’s, or does not exist', async () => {
      repo.cancel.mockResolvedValue(null);
      repo.find.mockResolvedValue(null);

      const err = await refusal(service.cancel(auth, ANNOUNCEMENT_ID));

      expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(repo.find).toHaveBeenCalledWith(1, ANNOUNCEMENT_ID);
    });
  });

  describe('moving one (US-MSG-05)', () => {
    const LATER_STILL = new Date('2026-08-02T08:00:00.000Z');

    it('moves it to the new time', async () => {
      await service.reschedule(auth, ANNOUNCEMENT_ID, LATER_STILL);

      expect(repo.reschedule).toHaveBeenCalledWith(1, ANNOUNCEMENT_ID, {
        sendAt: LATER_STILL,
        now: NOW,
      });
    });

    it('checks the new time before touching anything', async () => {
      const err = await refusal(service.reschedule(auth, ANNOUNCEMENT_ID, NOW));

      expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(repo.reschedule).not.toHaveBeenCalled();
    });

    it('says it can no longer be changed once it has started sending', async () => {
      repo.reschedule.mockResolvedValue(null);
      repo.find.mockResolvedValue(listed({ status: 'sent' }));

      const err = await refusal(
        service.reschedule(auth, ANNOUNCEMENT_ID, LATER_STILL),
      );

      expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(err.message).toBe(ALREADY_SENT);
    });

    it('404s one that is not the caller’s', async () => {
      repo.reschedule.mockResolvedValue(null);

      const err = await refusal(
        service.reschedule(auth, ANNOUNCEMENT_ID, LATER_STILL),
      );

      expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
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
