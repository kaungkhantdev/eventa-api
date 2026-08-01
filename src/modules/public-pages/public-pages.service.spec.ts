import type { Clock } from '../../common/time/clock';
import { PublicPagesRepository } from './public-pages.repository';
import { PublicPagesService } from './public-pages.service';

const NOW = new Date('2026-08-01T00:00:00Z');
const SLUG = 'bangkok-summit';

const baseEvent = {
  id: 'e1',
  organizationId: 1,
  slug: SLUG,
  name: 'Bangkok Summit',
  description: 'A great day',
  type: 'Conference',
  status: 'upcoming',
  visibility: 'public',
  startAt: new Date('2026-09-01T02:00:00Z'),
  endAt: new Date('2026-09-01T10:00:00Z'),
  timezone: 'Asia/Bangkok',
  isOnline: false,
  onlineNote: null,
  venueName: 'BITEC',
  venueAddress: '88 Bangna',
  city: 'Bangkok',
  coverImage: 'https://cdn/x.jpg',
  accentColor: '#1D4ED8',
  organizerName: 'Acme',
  landingTemplateId: 'aurora',
  agendaTitle: null,
  speakersTitle: null,
  categoryName: null,
  locale: 'en',
  publishedAt: new Date('2026-07-01T00:00:00Z'),
};

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'General',
  priceSatang: 107000,
  isFree: false,
  status: 'onsale',
  total: 100,
  sold: 0,
  includes: ['Lunch'],
  isRecommended: false,
  badge: null,
  salesStartAt: null,
  salesEndAt: null,
  ...over,
});

describe('PublicPagesService (US-PAGE-01…06, 08)', () => {
  let repo: jest.Mocked<PublicPagesRepository>;
  let service: PublicPagesService;

  const load = (over: Record<string, unknown> = {}) =>
    repo.findPublishedBySlug.mockResolvedValue({
      ...baseEvent,
      ...over,
    } as never);

  beforeEach(() => {
    repo = {
      findPublishedBySlug: jest.fn(),
      highlights: jest.fn().mockResolvedValue([]),
      agenda: jest.fn().mockResolvedValue([]),
      speakers: jest.fn().mockResolvedValue([]),
      tickets: jest.fn().mockResolvedValue([]),
      faqs: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PublicPagesRepository>;
    const clock: Clock = { now: () => NOW };
    service = new PublicPagesService(repo, clock, {
      getOrThrow: () => 'https://eventa.test',
    } as never);
    load();
  });

  describe('US-PAGE-01 — opening the page', () => {
    it('returns the identity, when and where with no sign-in needed', async () => {
      const page = await service.getPage(SLUG);
      expect(page.event).toMatchObject({
        name: 'Bangkok Summit',
        venueName: 'BITEC',
        timezone: 'Asia/Bangkok',
      });
    });

    it('404s a slug that points at no live event', async () => {
      repo.findPublishedBySlug.mockResolvedValue(null);
      await expect(service.getPage('nope')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('omits every empty section rather than rendering a blank heading', async () => {
      const page = await service.getPage(SLUG);
      expect(page.highlights).toEqual([]);
      expect(page.agenda).toEqual([]);
      expect(page.faqs).toEqual([]);
      expect(page.tickets).toEqual([]);
    });
  });

  describe('US-PAGE-03 — online vs in-person', () => {
    it('an online event says so and never exposes an address', async () => {
      load({
        isOnline: true,
        onlineNote: 'Join link sent after you register',
        venueName: 'Secret Room',
        venueAddress: '1 Hidden St',
      });
      const page = await service.getPage(SLUG);
      expect(page.event.isOnline).toBe(true);
      expect(page.event.venueAddress).toBeNull();
      expect(page.event.venueName).toBeNull();
      expect(page.event.onlineNote).toMatch(/after you register/i);
    });

    it('an in-person event shows the venue and address', async () => {
      const page = await service.getPage(SLUG);
      expect(page.event.venueAddress).toBe('88 Bangna');
    });
  });

  describe('US-PAGE-05 — tickets', () => {
    it('prices are VAT-inclusive Baht, formatted', async () => {
      repo.tickets.mockResolvedValue([ticket()] as never);
      const [t] = (await service.getPage(SLUG)).tickets;
      expect(t.priceLabel).toBe('฿1,070');
      expect(t.canRegister).toBe(true);
    });

    it('a free tier reads "Free" with no price prefix', async () => {
      repo.tickets.mockResolvedValue([
        ticket({ isFree: true, priceSatang: 0 }),
      ] as never);
      expect((await service.getPage(SLUG)).tickets[0].priceLabel).toBe('Free');
    });

    it('a sold-out tier cannot be registered for', async () => {
      repo.tickets.mockResolvedValue([
        ticket({ total: 10, sold: 10 }),
      ] as never);
      const [t] = (await service.getPage(SLUG)).tickets;
      expect(t.soldOut).toBe(true);
      expect(t.canRegister).toBe(false);
    });

    it('shows an urgency line when very few remain', async () => {
      repo.tickets.mockResolvedValue([
        ticket({ total: 100, sold: 97 }),
      ] as never);
      expect((await service.getPage(SLUG)).tickets[0].urgency).toMatch(
        /only 3 left/i,
      );
    });

    it('no urgency line when there is plenty left', async () => {
      repo.tickets.mockResolvedValue([ticket()] as never);
      expect((await service.getPage(SLUG)).tickets[0].urgency).toBeNull();
    });

    it('surfaces the recommended tier and its badge', async () => {
      repo.tickets.mockResolvedValue([
        ticket({ isRecommended: true, badge: 'Most popular' }),
      ] as never);
      const [t] = (await service.getPage(SLUG)).tickets;
      expect(t).toMatchObject({ isRecommended: true, badge: 'Most popular' });
    });
  });

  describe('US-PAGE-02/05 — registration state', () => {
    it('is open for a published, future event with tickets', async () => {
      repo.tickets.mockResolvedValue([ticket()] as never);
      expect((await service.getPage(SLUG)).registration.open).toBe(true);
    });

    it('closes once the event has started, disabling every tier', async () => {
      load({ startAt: new Date('2026-07-01T00:00:00Z') });
      repo.tickets.mockResolvedValue([ticket()] as never);
      const page = await service.getPage(SLUG);
      expect(page.registration.open).toBe(false);
      expect(page.registration.reason).toMatch(/closed/i);
      expect(page.tickets[0].canRegister).toBe(false);
    });

    it('is not open before a tier goes on sale', async () => {
      repo.tickets.mockResolvedValue([
        ticket({ salesStartAt: new Date('2026-08-20T00:00:00Z') }),
      ] as never);
      const page = await service.getPage(SLUG);
      expect(page.registration.open).toBe(false);
      expect(page.registration.reason).toMatch(/isn.t open yet/i);
    });
  });

  describe('US-PAGE-04 — section titles', () => {
    it('uses the organizer titles when set', async () => {
      load({ agendaTitle: 'Programme', speakersTitle: 'Our line-up' });
      const page = await service.getPage(SLUG);
      expect(page.sections).toEqual({
        agenda: 'Programme',
        speakers: 'Our line-up',
      });
    });

    it('falls back to sensible defaults', async () => {
      const page = await service.getPage(SLUG);
      expect(page.sections.agenda).toBeTruthy();
      expect(page.sections.speakers).toBeTruthy();
    });
  });

  describe('US-PAGE-08 — share card', () => {
    it('carries the title, description, image and clean public URL', async () => {
      const page = await service.getPage(SLUG);
      expect(page.share).toMatchObject({
        title: 'Bangkok Summit',
        image: 'https://cdn/x.jpg',
        url: `https://eventa.test/e/${SLUG}`,
        noIndex: false,
      });
      expect(page.share.url).not.toMatch(/[?&]/); // no tracking or personal data
    });

    it('falls back to a branded image when the cover is missing', async () => {
      load({ coverImage: null });
      const page = await service.getPage(SLUG);
      expect(page.share.image).toBeNull(); // template renders its branded default
      expect(page.event.coverImage).toBeNull();
    });
  });
});
