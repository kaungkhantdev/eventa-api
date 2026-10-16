import { PHONE_LOCATION } from './meeting-schedule';
import { toMeetingEntry } from './meetings.mapper';
import type { MeetingRow } from './meetings.types';

const NOW = new Date('2026-08-07T09:00:00Z'); // 16:00 Bangkok

const row = (o: Partial<MeetingRow> = {}): MeetingRow => ({
  id: 'm-1',
  organizationId: 7,
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
  eventId: 'e-1',
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

const placeOf = (o: Partial<MeetingRow>) =>
  toMeetingEntry(row(o), null, NOW).place;

/**
 * US-MTG-03: "Given I set the mode to In person, then the meeting shows the
 * related event's venue as its location; given Phone, then it shows 'Phone
 * call'."
 */
describe('toMeetingEntry place (US-MTG-03)', () => {
  it('shows the event venue for an in-person meeting', () => {
    expect(placeOf({ mode: 'In person', location: 'QSNCC Hall 2' })).toBe(
      'QSNCC Hall 2',
    );
  });

  it('never calls an in-person meeting with no venue a phone call', () => {
    // A general meeting, or one about an event with no venue name, has no
    // location to show — which is not the same as being on the phone.
    expect(placeOf({ mode: 'In person', location: null })).toBeNull();
  });

  it('says "Phone call" for a phone meeting', () => {
    expect(placeOf({ mode: 'Phone', location: PHONE_LOCATION })).toBe(
      'Phone call',
    );
  });

  it('shows the join link for a video meeting', () => {
    expect(placeOf({ mode: 'Video', link: 'https://meet/x' })).toBe(
      'https://meet/x',
    );
  });
});
