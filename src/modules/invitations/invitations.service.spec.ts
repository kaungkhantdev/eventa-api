import type { ConfigService } from '@nestjs/config';
import type { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import type { EventsService } from '../events/events.service';
import { INVITE_SENT_ROUTING_KEY } from './events/invite-sent.event';
import type { InvitationsRepository } from './invitations.repository';
import { InvitationsService } from './invitations.service';
import { INVITE_DEDUPE_WINDOW_MS } from './invitations.types';

const ORG = 7;
const EVENT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-06-15T02:00:00Z');

const auth: AuthContext = {
  userId: 'organizer-1',
  organizationId: ORG,
  sessionId: 's-1',
  persona: 'admin',
};

const input = (o: Record<string, unknown> = {}) => ({
  eventId: EVENT,
  recipientName: 'Anan Suksawat',
  recipientEmail: 'anan@example.com',
  ...o,
});

describe('InvitationsService (US-REG-06)', () => {
  let repo: jest.Mocked<InvitationsRepository>;
  let events: jest.Mocked<EventsService>;
  let service: InvitationsService;

  beforeEach(() => {
    repo = {
      record: jest.fn().mockResolvedValue({ sent: true, sentAt: NOW }),
    } as unknown as jest.Mocked<InvitationsRepository>;
    events = {
      getEvent: jest.fn().mockResolvedValue({
        id: EVENT,
        name: 'Bangkok Tech Week',
        slug: 'btw',
      }),
    } as unknown as jest.Mocked<EventsService>;
    const clock: Clock = { now: () => NOW };
    const config = {
      getOrThrow: jest.fn().mockReturnValue('https://eventa.test'),
    } as unknown as ConfigService<never, true>;
    service = new InvitationsService(repo, events, clock, config);
  });

  it('records the invite and queues exactly one email', async () => {
    const result = await service.invite(auth, input());
    expect(result.sent).toBe(true);
    expect(repo.record).toHaveBeenCalledTimes(1);
  });

  it('builds an ABSOLUTE registration link — a relative one is dead in an email', async () => {
    await service.invite(auth, input());
    const buildEvent = repo.record.mock.calls[0][1];
    const event = buildEvent(NOW);
    expect(event.routingKey).toBe(INVITE_SENT_ROUTING_KEY);
    expect(event.payload.registerUrl).toBe('https://eventa.test/events/btw');
    expect(event.payload.version).toBe(1);
  });

  it('carries the personal note into the email', async () => {
    await service.invite(auth, input({ message: '  Hope you can make it  ' }));
    const event = repo.record.mock.calls[0][1](NOW);
    expect(event.payload.message).toBe('Hope you can make it');
  });

  it('normalises the email so case cannot create a second invite', async () => {
    await service.invite(
      auth,
      input({ recipientEmail: '  ANAN@Example.COM ' }),
    );
    expect(repo.record.mock.calls[0][0].recipientEmail).toBe(
      'anan@example.com',
    );
  });

  it('suppresses — not refuses — a repeat inside the window', async () => {
    // The organizer's intent was "make sure they were asked"; an error would
    // be a worse answer than silence.
    repo.record.mockResolvedValue(null);
    const result = await service.invite(auth, input());
    expect(result.sent).toBe(false);
    expect(result.recipientEmail).toBe('anan@example.com');
  });

  it('passes a resend cutoff one window back', async () => {
    await service.invite(auth, input());
    const { resendCutoff } = repo.record.mock.calls[0][0];
    expect(NOW.getTime() - resendCutoff.getTime()).toBe(
      INVITE_DEDUPE_WINDOW_MS,
    );
  });

  it('resolves the event first, so another workspace never gets an invite', async () => {
    events.getEvent.mockRejectedValue(new Error('not found'));
    await expect(service.invite(auth, input())).rejects.toThrow();
    expect(repo.record).not.toHaveBeenCalled();
  });

  it('reserves no seat — nothing about capacity is touched', async () => {
    // An invite is a promise to attend, not a booking (story note). The only
    // collaborators are the event lookup and the invitation record.
    await service.invite(auth, input());
    expect(Object.keys(repo)).toEqual(['record']);
  });
});
