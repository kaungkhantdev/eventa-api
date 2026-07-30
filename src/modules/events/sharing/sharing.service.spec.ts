import type { ConfigService } from '@nestjs/config';
import type { EventResponseDto } from '../dto/event-response.dto';
import type { EventsService } from '../events.service';
import { SharingService } from './sharing.service';

const actor = { organizationId: 1, userId: 'u1' };

function eventDto(o: Partial<EventResponseDto> = {}): EventResponseDto {
  return {
    slug: 'my-event',
    name: 'My Event',
    startAt: '2026-09-01T02:00:00Z',
    venueName: 'Grand Hall',
    city: null,
    isOnline: false,
    visibility: 'public',
    status: 'upcoming',
    ...o,
  } as unknown as EventResponseDto;
}

function build(event: EventResponseDto) {
  const events = {
    getEvent: jest.fn().mockResolvedValue(event),
  } as unknown as jest.Mocked<EventsService>;
  const config = {
    getOrThrow: jest.fn().mockReturnValue('https://web.test'),
  } as unknown as ConfigService;
  return { events, service: new SharingService(events, config) };
}

describe('SharingService', () => {
  it('builds the public link, message, and per-channel share URLs', async () => {
    const { service } = build(eventDto());
    const res = await service.share(actor, 'e1');

    expect(res.publicUrl).toBe('https://web.test/e/my-event');
    expect(res.registrationUrl).toBe('https://web.test/e/my-event');
    expect(res.shareMessage).toMatch(/^Join me at My Event/);
    expect(res.shareMessage).toContain('Grand Hall');
    expect(res.shareMessage).toContain('2026');
    // Channels carry the encoded link/message.
    const encoded = encodeURIComponent('https://web.test/e/my-event');
    expect(res.channels.facebook).toContain(encoded);
    expect(res.channels.whatsapp).toContain(
      encodeURIComponent('Join me at My Event'),
    );
    expect(res.channels.email.startsWith('mailto:?')).toBe(true);
    expect(res.isPublic).toBe(true);
    expect(res.warning).toBeNull();
  });

  it('uses "online" as the location when there is no venue', async () => {
    const { service } = build(
      eventDto({ venueName: null, city: null, isOnline: true }),
    );
    const res = await service.share(actor, 'e1');
    expect(res.shareMessage).toContain('online');
  });

  it('warns when the event is not publicly reachable (draft)', async () => {
    const { service } = build(
      eventDto({ status: 'draft', visibility: 'private' }),
    );
    const res = await service.share(actor, 'e1');
    expect(res.isPublic).toBe(false);
    expect(res.warning).toMatch(/public/i);
  });
});
