import { DomainException } from '../../common/errors/domain.exception';
import type { EventsService } from '../events/events.service';
import { EventPageRepository } from './event-page.repository';
import { EventPageService } from './event-page.service';

const actor = { organizationId: 1, userId: 'u1' };
const eventId = 'e1';

describe('EventPageService (US-PAGE-09/10)', () => {
  let repo: jest.Mocked<EventPageRepository>;
  let events: jest.Mocked<EventsService>;
  let service: EventPageService;

  beforeEach(() => {
    repo = {
      slugTaken: jest.fn().mockResolvedValue(false),
      updatePage: jest.fn().mockResolvedValue({
        slug: 'my-event',
        landingTemplateId: 'noir',
        accentColor: '#1D4ED8',
        visibility: 'public',
      }),
    } as unknown as jest.Mocked<EventPageRepository>;
    events = {
      getEvent: jest.fn().mockResolvedValue({ id: eventId, name: 'Summit' }),
    } as unknown as jest.Mocked<EventsService>;
    service = new EventPageService(repo, events);
  });

  describe('US-PAGE-10 — design, address and colour', () => {
    it('binds a design and keeps the content', async () => {
      const res = await service.updatePage(actor, eventId, {
        template: 'noir',
      });
      expect(repo.updatePage).toHaveBeenCalledWith(
        1,
        eventId,
        expect.objectContaining({ landingTemplateId: 'noir' }),
      );
      expect(res.template).toBe('noir');
    });

    it('rejects a public address already in use, asking for another', async () => {
      repo.slugTaken.mockResolvedValue(true);
      await expect(
        service.updatePage(actor, eventId, { slug: 'taken' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(repo.updatePage).not.toHaveBeenCalled();
    });

    it('normalises the address it saves', async () => {
      await service.updatePage(actor, eventId, { slug: '  My Event  ' });
      expect(repo.updatePage).toHaveBeenCalledWith(
        1,
        eventId,
        expect.objectContaining({ slug: 'my-event' }),
      );
    });

    it('an invalid accent colour quietly falls back to the brand default', async () => {
      await service.updatePage(actor, eventId, { accentColor: 'not-a-colour' });
      const [, , values] = repo.updatePage.mock.calls[0];
      expect(values.accentColor).toMatch(/^#[0-9A-F]{6}$/i);
      expect(values.accentColor).not.toBe('not-a-colour');
    });

    it('keeps a valid accent colour', async () => {
      await service.updatePage(actor, eventId, { accentColor: '#AABBCC' });
      const [, , values] = repo.updatePage.mock.calls[0];
      expect(values.accentColor).toBe('#AABBCC');
    });

    it('404s an event outside the caller org', async () => {
      events.getEvent.mockRejectedValue(DomainException.notFound('nope'));
      await expect(
        service.updatePage(actor, eventId, { template: 'noir' }),
      ).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('US-PAGE-09 — preview', () => {
    it('renders the supplied unsaved values without persisting anything', async () => {
      const page = await service.preview(actor, {
        name: 'Unsaved Title',
        isOnline: true,
        highlights: ['Free coffee'],
        template: 'minimal',
      });

      expect(page.event.name).toBe('Unsaved Title');
      expect(page.event.isOnline).toBe(true);
      expect(page.highlights[0].text).toBe('Free coffee');
      expect(page.event.template).toBe('minimal');
      // nothing was written
      expect(repo.updatePage).not.toHaveBeenCalled();
    });

    it('marks a preview so it is never indexed or counted', async () => {
      const page = await service.preview(actor, { name: 'Draft' });
      expect(page.share.noIndex).toBe(true);
      expect(page.isPreview).toBe(true);
    });

    it('an online preview never shows an address', async () => {
      const page = await service.preview(actor, {
        name: 'Webinar',
        isOnline: true,
        venueAddress: '1 Somewhere Rd',
      });
      expect(page.event.venueAddress).toBeNull();
    });
  });
});
