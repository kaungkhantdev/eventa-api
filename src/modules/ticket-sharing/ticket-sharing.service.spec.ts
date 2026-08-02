import type { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain.exception';
import type { EventsService } from '../events/events.service';
import type { TicketingService } from '../ticketing/ticketing.service';
import { TicketSharingService } from './ticket-sharing.service';

const actor = { organizationId: 1, userId: 'u1' };
const EVENT_ID = 'e1';
const TICKET_ID = 't1';

const config = {
  getOrThrow: () => 'https://eventa.test',
} as unknown as ConfigService;

const event = (o: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  slug: 'bangkok-summit',
  name: 'Bangkok Summit',
  status: 'upcoming',
  visibility: 'public',
  ...o,
});

describe('TicketSharingService (US-TKT-06)', () => {
  let events: jest.Mocked<EventsService>;
  let tickets: jest.Mocked<TicketingService>;
  let service: TicketSharingService;

  beforeEach(() => {
    events = {
      getEvent: jest.fn().mockResolvedValue(event()),
    } as unknown as jest.Mocked<EventsService>;
    tickets = {
      listTickets: jest
        .fn()
        .mockResolvedValue([{ id: TICKET_ID, name: 'VIP pass' }]),
    } as unknown as jest.Mocked<TicketingService>;
    service = new TicketSharingService(events, tickets, config);
  });

  it('returns a registration link that preselects the ticket type', async () => {
    const res = await service.share(actor, EVENT_ID, TICKET_ID);
    expect(res.registrationUrl).toBe(
      `https://eventa.test/e/bangkok-summit/register?ticket=${TICKET_ID}`,
    );
    expect(res.ticketName).toBe('VIP pass');
  });

  it('returns a QR that encodes exactly the same link', async () => {
    const res = await service.share(actor, EVENT_ID, TICKET_ID);
    expect(res.qrSvg).toContain('<svg');
    // a scannable QR is worthless if it points somewhere else than the link
    expect(res.qrEncodes).toBe(res.registrationUrl);
  });

  it('404s for a ticket that is not on the event', async () => {
    tickets.listTickets.mockResolvedValue([]);
    const err = await service
      .share(actor, EVENT_ID, 'missing')
      .catch((e: unknown) => e);
    expect((err as DomainException).getStatus()).toBe(404);
  });

  it('prompts to publish first when the event is still a draft', async () => {
    events.getEvent.mockResolvedValue(event({ status: 'draft' }));
    const res = await service.share(actor, EVENT_ID, TICKET_ID);
    expect(res.isPublished).toBe(false);
    expect(res.warning).toMatch(/publish/i);
  });

  it('treats a private event as not yet shareable either', async () => {
    events.getEvent.mockResolvedValue(event({ visibility: 'private' }));
    const res = await service.share(actor, EVENT_ID, TICKET_ID);
    expect(res.isPublished).toBe(false);
  });

  it('has no warning once the event is live', async () => {
    const res = await service.share(actor, EVENT_ID, TICKET_ID);
    expect(res.isPublished).toBe(true);
    expect(res.warning).toBeNull();
  });

  it('renders a standalone printable QR for download', async () => {
    const svg = await service.qrImage(actor, EVENT_ID, TICKET_ID);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
  });
});
