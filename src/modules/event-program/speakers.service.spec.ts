import { DomainException } from '../../common/errors/domain.exception';
import { EventsService } from '../events/events.service';
import { SpeakersRepository } from './speakers.repository';
import { SpeakersService } from './speakers.service';
import type { SpeakerRow } from './speakers.types';

const actor = { organizationId: 1, userId: 'u1' };
const eventId = 'e1';

function speakerRow(o: Partial<SpeakerRow> = {}): SpeakerRow {
  return {
    id: 'sp1',
    organizationId: 1,
    eventId: 'e1',
    name: 'Ada Lovelace',
    role: null,
    email: null,
    phone: null,
    talkTitle: null,
    tag: null,
    initials: null,
    tone: null,
    rating: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    ...o,
  };
}

describe('SpeakersService', () => {
  let repo: jest.Mocked<SpeakersRepository>;
  let events: jest.Mocked<EventsService>;
  let service: SpeakersService;

  beforeEach(() => {
    repo = {
      insert: jest
        .fn()
        .mockImplementation((v: Partial<SpeakerRow>) =>
          Promise.resolve(speakerRow(v)),
        ),
      listByEvent: jest.fn().mockResolvedValue([]),
      page: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findSpeaker: jest.fn().mockResolvedValue(speakerRow()),
      update: jest
        .fn()
        .mockImplementation((_o: number, _id: string, v: Partial<SpeakerRow>) =>
          Promise.resolve(speakerRow({ ...v, version: 2 })),
        ),
      softDelete: jest.fn().mockResolvedValue(true),
      sessionCounts: jest.fn().mockResolvedValue(new Map<string, number>()),
    } as unknown as jest.Mocked<SpeakersRepository>;
    events = {
      getEvent: jest.fn().mockResolvedValue({ id: eventId }),
    } as unknown as jest.Mocked<EventsService>;
    service = new SpeakersService(repo, events);
  });

  describe('createSpeaker', () => {
    it('verifies the event belongs to the org before inserting', async () => {
      await service.createSpeaker(actor, eventId, { name: 'Ada' });
      expect(events.getEvent).toHaveBeenCalledWith(actor, eventId);
      expect(repo.insert).toHaveBeenCalledTimes(1);
    });

    it('requires a non-blank name (422)', async () => {
      const err = await service
        .createSpeaker(actor, eventId, { name: '   ' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('persists the optional fields (role, talk, tag, tone)', async () => {
      await service.createSpeaker(actor, eventId, {
        name: 'Grace',
        role: 'CTO',
        talkTitle: 'Compilers',
        tag: 'Keynote',
        tone: 'blue',
      });
      const values = repo.insert.mock.calls[0][0];
      expect(values).toMatchObject({
        name: 'Grace',
        role: 'CTO',
        talkTitle: 'Compilers',
        tag: 'Keynote',
        tone: 'blue',
        eventId,
        organizationId: 1,
      });
    });
  });

  describe('updateSpeaker', () => {
    it('throws 404 when the speaker is not on the event', async () => {
      repo.findSpeaker.mockResolvedValue(null);
      const err = await service
        .updateSpeaker(actor, eventId, 'missing', { role: 'X' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects a stale version (409)', async () => {
      const err = await service
        .updateSpeaker(actor, eventId, 'sp1', { role: 'X', version: 99 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('applies the change and returns the speaker', async () => {
      const res = await service.updateSpeaker(actor, eventId, 'sp1', {
        role: 'Host',
      });
      expect(repo.update).toHaveBeenCalled();
      expect(res).toMatchObject({ role: 'Host' });
    });
  });

  describe('deleteSpeaker', () => {
    it('soft-deletes an existing speaker', async () => {
      await service.deleteSpeaker(actor, eventId, 'sp1');
      expect(repo.softDelete).toHaveBeenCalledWith(1, 'sp1');
    });

    it('throws 404 when the speaker is absent', async () => {
      repo.findSpeaker.mockResolvedValue(null);
      const err = await service
        .deleteSpeaker(actor, eventId, 'missing')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });
});

describe('SpeakersService — session counts (US-PROG-02/04/08/09)', () => {
  let repo: jest.Mocked<SpeakersRepository>;
  let service: SpeakersService;

  beforeEach(() => {
    repo = {
      insert: jest
        .fn()
        .mockImplementation((v: Partial<SpeakerRow>) =>
          Promise.resolve(speakerRow(v)),
        ),
      page: jest.fn().mockResolvedValue({
        items: [speakerRow({ id: 'sp1' }), speakerRow({ id: 'sp2' })],
        total: 2,
      }),
      findSpeaker: jest.fn().mockResolvedValue(speakerRow({ id: 'sp1' })),
      sessionCounts: jest.fn().mockResolvedValue(new Map([['sp1', 3]])),
    } as unknown as jest.Mocked<SpeakersRepository>;
    const events = {
      getEvent: jest.fn().mockResolvedValue({ id: eventId }),
    } as unknown as jest.Mocked<EventsService>;
    service = new SpeakersService(repo, events);
  });

  it('reports how many sessions each speaker is booked into', async () => {
    const { items } = await service.listSpeakers(actor, eventId);
    const [first, second] = items;
    expect(first.sessionCount).toBe(3);
    // A speaker in nothing yet is 0, never undefined — the directory shows it.
    expect(second.sessionCount).toBe(0);
  });

  it('asks for the counts of exactly the speakers it listed', async () => {
    await service.listSpeakers(actor, eventId);
    expect(repo.sessionCounts).toHaveBeenCalledWith(actor.organizationId, [
      'sp1',
      'sp2',
    ]);
  });

  it('gives a brand-new speaker a count of zero', async () => {
    const created = await service.createSpeaker(actor, eventId, {
      name: 'Ada Lovelace',
    });
    expect(created.sessionCount).toBe(0);
  });

  it('does not query counts for an empty directory', async () => {
    repo.page.mockResolvedValue({ items: [], total: 0 });
    const page = await service.listSpeakers(actor, eventId);
    expect(page.items).toEqual([]);
    // An empty search is a page with no rows, never an error (US-PROG-08).
    expect(page.meta.total).toBe(0);
    expect(repo.sessionCounts).not.toHaveBeenCalled();
  });

  it('passes the search term and page through to the repository', async () => {
    await service.listSpeakers(actor, eventId, { search: 'ada', page: 2 });
    expect(repo.page).toHaveBeenCalledWith(
      actor.organizationId,
      eventId,
      expect.objectContaining({ search: 'ada', page: 2 }),
    );
  });

  it('reports the FILTERED total, so the count matches the list', async () => {
    repo.page.mockResolvedValue({
      items: [speakerRow({ id: 'sp1' })],
      total: 1,
    });
    const page = await service.listSpeakers(actor, eventId, { search: 'ada' });
    expect(page.meta.total).toBe(1);
  });
});

describe('SpeakersService — one email per event (US-PROG-09/10)', () => {
  let repo: jest.Mocked<SpeakersRepository>;
  let service: SpeakersService;

  beforeEach(() => {
    repo = {
      insert: jest
        .fn()
        .mockImplementation((v: Partial<SpeakerRow>) =>
          Promise.resolve(speakerRow(v)),
        ),
      findSpeaker: jest.fn().mockResolvedValue(speakerRow()),
      findByEmail: jest.fn().mockResolvedValue(null),
      update: jest
        .fn()
        .mockImplementation((_o: number, _id: string, v: Partial<SpeakerRow>) =>
          Promise.resolve(speakerRow({ ...v, version: 2 })),
        ),
      sessionCounts: jest.fn().mockResolvedValue(new Map<string, number>()),
    } as unknown as jest.Mocked<SpeakersRepository>;
    const events = {
      getEvent: jest.fn().mockResolvedValue({ id: eventId }),
    } as unknown as jest.Mocked<EventsService>;
    service = new SpeakersService(repo, events);
  });

  it('refuses a second speaker with the same email', async () => {
    repo.findByEmail.mockResolvedValue(speakerRow({ id: 'other' }));
    await expect(
      service.createSpeaker(actor, eventId, {
        name: 'Ada',
        email: 'ada@example.com',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('allows a speaker with no email at all, however many', async () => {
    // Most speakers are added without one; they must not collide.
    await service.createSpeaker(actor, eventId, { name: 'Anon One' });
    await service.createSpeaker(actor, eventId, { name: 'Anon Two' });
    expect(repo.findByEmail).not.toHaveBeenCalled();
    expect(repo.insert).toHaveBeenCalledTimes(2);
  });

  it('lets a speaker keep their own email when edited', async () => {
    // The uniqueness check must exclude the row being edited, or every PATCH
    // that resends the email would refuse itself.
    await service.updateSpeaker(actor, eventId, 'sp1', {
      email: 'ada@example.com',
    });
    expect(repo.findByEmail).toHaveBeenCalledWith(
      actor.organizationId,
      eventId,
      'ada@example.com',
      'sp1',
    );
    expect(repo.update).toHaveBeenCalled();
  });

  it('refuses an edit that takes another speaker’s email', async () => {
    repo.findByEmail.mockResolvedValue(speakerRow({ id: 'other' }));
    await expect(
      service.updateSpeaker(actor, eventId, 'sp1', {
        email: 'taken@example.com',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
