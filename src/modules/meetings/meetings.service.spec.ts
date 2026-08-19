import type { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import { MeetingsService } from './meetings.service';
import type { MeetingsRepository } from './meetings.repository';
import type { MeetingEventPort } from './ports/meeting-event.port';
import type { MeetingRow } from './meetings.types';

const ORG = 7;
const ID = 'm-1';
const EVENT = 'e-1';
const NOW = new Date('2026-08-07T09:00:00Z'); // 16:00 Bangkok

const auth: AuthContext = {
  userId: 'u-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const row = (o: Partial<MeetingRow> = {}): MeetingRow => ({
  id: ID,
  organizationId: ORG,
  title: 'Venue walkthrough',
  meetingDate: '2026-08-10',
  startTime: '09:00:00',
  endTime: '10:00:00',
  type: 'Venue',
  mode: 'Video',
  status: 'scheduled',
  person: 'Khun Malee',
  role: 'Venue manager',
  guestEmail: 'malee@venue.co.th',
  eventId: EVENT,
  link: null,
  location: null,
  notes: null,
  cancellationReason: null,
  cancelledAt: null,
  syncStatus: 'pending',
  externalEventId: null,
  syncError: null,
  idempotencyKey: 'k-1',
  createdBy: 'u-1',
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  version: 1,
  ...o,
});

const command = (o: Record<string, unknown> = {}) => ({
  title: 'Venue walkthrough',
  date: '2026-08-10',
  startTime: '09:00',
  endTime: '10:00',
  type: 'Venue' as const,
  mode: 'Video' as const,
  person: 'Khun Malee',
  guestEmail: 'malee@venue.co.th',
  eventId: EVENT,
  ...o,
});

describe('MeetingsService (US-MTG-03/04/05)', () => {
  let repo: jest.Mocked<MeetingsRepository>;
  let events: jest.Mocked<MeetingEventPort>;
  let service: MeetingsService;

  beforeEach(() => {
    repo = {
      schedule: jest.fn().mockResolvedValue({ meeting: row(), created: true }),
      reschedule: jest.fn().mockResolvedValue(row({ version: 2 })),
      cancel: jest.fn().mockResolvedValue(row({ status: 'cancelled' })),
      retrySync: jest.fn().mockResolvedValue(row()),
      findById: jest.fn().mockResolvedValue(row()),
    } as unknown as jest.Mocked<MeetingsRepository>;
    events = {
      findForMeeting: jest.fn().mockResolvedValue({
        id: EVENT,
        name: 'Jazz Fest',
        venueName: 'QSNCC',
      }),
      namesByIds: jest.fn(),
      idsMatchingName: jest.fn(),
    };
    const clock: Clock = { now: () => NOW };
    service = new MeetingsService(repo, events, clock);
  });

  describe('scheduling (US-MTG-03)', () => {
    it('books a well-formed meeting', async () => {
      const { created } = await service.schedule(auth, command());
      expect(created).toBe(true);
    });

    it('refuses a past date without writing anything', async () => {
      await expect(
        service.schedule(auth, command({ date: '2026-08-01' })),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(repo.schedule).not.toHaveBeenCalled();
    });

    it('refuses an end time that is not after the start', async () => {
      await expect(
        service.schedule(
          auth,
          command({ startTime: '10:00', endTime: '09:00' }),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('gives a video meeting no location and asks for a link', async () => {
      await service.schedule(auth, command({ mode: 'Video' }));
      const [, input] = repo.schedule.mock.calls[0];
      expect(input.location).toBeNull();
    });

    it('locates an in-person meeting at the event’s venue', async () => {
      await service.schedule(auth, command({ mode: 'In person' }));
      const [, input] = repo.schedule.mock.calls[0];
      expect(input.location).toBe('QSNCC');
    });

    it('says "Phone call" for a phone meeting', async () => {
      await service.schedule(auth, command({ mode: 'Phone' }));
      const [, input] = repo.schedule.mock.calls[0];
      expect(input.location).toBe('Phone call');
    });

    it('allows a general meeting with no event at all', async () => {
      await service.schedule(auth, command({ eventId: undefined }));
      const [, input] = repo.schedule.mock.calls[0];
      expect(input.eventId).toBeNull();
      expect(events.findForMeeting).not.toHaveBeenCalled();
    });

    it('refuses an event from another workspace', async () => {
      events.findForMeeting.mockResolvedValue(null);
      await expect(service.schedule(auth, command())).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(repo.schedule).not.toHaveBeenCalled();
    });

    it('carries an idempotency key so a double-tap books once', async () => {
      await service.schedule(auth, command());
      const [, input] = repo.schedule.mock.calls[0];
      expect(input.idempotencyKey).toEqual(expect.any(String));
    });

    it('asks the calendar for an invite in the same call', async () => {
      await service.schedule(auth, command());
      const [, , buildSync] = repo.schedule.mock.calls[0];
      const event = buildSync(row());
      expect(event.routingKey).toBe('meeting.sync_requested');
      expect(event.payload).toMatchObject({
        intent: 'create',
        needsLink: true,
      });
    });

    it('sends the calendar a UTC instant, not the Bangkok wall clock', async () => {
      await service.schedule(auth, command());
      const [, , buildSync] = repo.schedule.mock.calls[0];
      // 09:00 Bangkok on 10 Aug is 02:00 UTC.
      expect(buildSync(row()).payload).toMatchObject({
        startsAt: '2026-08-10T02:00:00.000Z',
      });
    });
  });

  describe('rescheduling (US-MTG-05)', () => {
    it('moves the meeting and asks the calendar to AMEND the invite', async () => {
      await service.reschedule(auth, ID, {
        version: 1,
        startTime: '11:00',
        endTime: '12:00',
      });
      const [, , , , buildSync] = repo.reschedule.mock.calls[0];
      expect(buildSync(row()).payload).toMatchObject({ intent: 'update' });
    });

    it('passes the version through as the concurrency guard', async () => {
      await service.reschedule(auth, ID, { version: 3 });
      expect(repo.reschedule.mock.calls[0][2]).toBe(3);
    });

    it('tells the organizer to reload when someone else saved first', async () => {
      repo.reschedule.mockResolvedValue(null);
      await expect(
        service.reschedule(auth, ID, { version: 1 }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('drops the Meet link when the mode becomes in person', async () => {
      repo.findById.mockResolvedValue(row({ link: 'https://meet/abc' }));
      await service.reschedule(auth, ID, { version: 1, mode: 'In person' });
      const [, , , patch] = repo.reschedule.mock.calls[0];
      expect(patch.link).toBeNull();
      expect(patch.location).toBe('QSNCC');
    });

    it('keeps the link when the meeting stays video', async () => {
      repo.findById.mockResolvedValue(row({ link: 'https://meet/abc' }));
      await service.reschedule(auth, ID, {
        version: 1,
        startTime: '11:00',
        endTime: '12:00',
      });
      const [, , , patch] = repo.reschedule.mock.calls[0];
      expect(patch.link).toBe('https://meet/abc');
    });

    it('refuses to edit a cancelled meeting', async () => {
      repo.findById.mockResolvedValue(row({ status: 'cancelled' }));
      await expect(
        service.reschedule(auth, ID, { version: 1 }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(repo.reschedule).not.toHaveBeenCalled();
    });

    it('keeps untouched fields when the DTO sends them as undefined', async () => {
      // A validated DTO materializes every declared field, so an untouched one
      // arrives present-and-undefined. Spreading that blanks the stored value.
      await service.reschedule(auth, ID, {
        version: 1,
        title: undefined,
        date: undefined,
        startTime: '11:00',
        endTime: '12:00',
        person: undefined,
      });
      const [, , , patch] = repo.reschedule.mock.calls[0];
      expect(patch.title).toBe('Venue walkthrough');
      expect(patch.meetingDate).toBe('2026-08-10');
      expect(patch.person).toBe('Khun Malee');
    });

    it('validates the MERGED meeting, not just the fields sent', async () => {
      // Moving only the start past the stored end must still be caught.
      await expect(
        service.reschedule(auth, ID, { version: 1, startTime: '23:00' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('404s a meeting from another workspace', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.reschedule(auth, ID, { version: 1 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('cancelling (US-MTG-06)', () => {
    it('records the reason and withdraws the invite', async () => {
      await service.cancel(auth, ID, 'Venue double-booked');
      expect(repo.cancel.mock.calls[0][2]).toBe('Venue double-booked');
      const buildSync = repo.cancel.mock.calls[0][3];
      expect(buildSync(row()).payload).toMatchObject({ intent: 'cancel' });
    });

    it('refuses to cancel twice', async () => {
      repo.cancel.mockResolvedValue(null);
      await expect(service.cancel(auth, ID, null)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('retrying the calendar (US-MTG-04)', () => {
    it('re-asks for a CREATE when the calendar never got the meeting', async () => {
      repo.findById.mockResolvedValue(row({ externalEventId: null }));
      await service.retrySync(auth, ID);
      const buildSync = repo.retrySync.mock.calls[0][2];
      expect(buildSync(row({ externalEventId: null })).payload).toMatchObject({
        intent: 'create',
      });
    });

    it('re-asks for an UPDATE when the invite already exists', async () => {
      await service.retrySync(auth, ID);
      const buildSync = repo.retrySync.mock.calls[0][2];
      expect(
        buildSync(row({ externalEventId: 'gcal-1' })).payload,
      ).toMatchObject({ intent: 'update' });
    });

    it('404s a meeting that is not ours', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.retrySync(auth, ID)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
