import { DomainException } from '../../common/errors/domain.exception';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import type { EventRow } from './events.types';

const auth = { organizationId: 1, userId: 'u1' };

function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'e1',
    organizationId: 1,
    slug: 'tech-conf',
    name: 'Tech Conf',
    description: null,
    type: 'Conference',
    status: 'draft',
    bucket: 'active',
    visibility: 'private',
    categoryId: null,
    startAt: new Date('2026-09-01T02:00:00Z'),
    endAt: null,
    timezone: 'Asia/Bangkok',
    venueName: null,
    venueAddress: null,
    city: null,
    isOnline: false,
    onlineNote: null,
    seatingMode: 'ga',
    capacity: null,
    coverImage: null,
    accentColor: null,
    organizerName: 'Acme',
    contactEmail: null,
    landingTemplateId: null,
    publishedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdBy: 'u1',
    version: 1,
    ...overrides,
  };
}

describe('EventsService.createDraft', () => {
  let repo: jest.Mocked<EventsRepository>;
  let service: EventsService;

  beforeEach(() => {
    repo = {
      existingSlugs: jest.fn().mockResolvedValue([]),
      organizationName: jest.fn().mockResolvedValue('Acme'),
      categoryExists: jest.fn().mockResolvedValue(true),
      insert: jest
        .fn()
        .mockImplementation((v: Partial<EventRow>) =>
          Promise.resolve(eventRow(v)),
        ),
      list: jest.fn(),
    } as unknown as jest.Mocked<EventsRepository>;
    service = new EventsService(repo);
  });

  it('slugifies the name and defaults status=draft, bucket=active, organizer from org', async () => {
    const res = await service.createDraft(auth, {
      name: 'Tech Conference 2026',
      type: 'Conference',
      startAt: new Date('2026-09-01T02:00:00Z'),
    });

    expect(repo.insert).toHaveBeenCalledTimes(1);
    const values = repo.insert.mock.calls[0][0];
    expect(values.slug).toBe('tech-conference-2026');
    expect(values.status).toBe('draft');
    expect(values.bucket).toBe('active');
    expect(values.organizationId).toBe(1);
    expect(values.createdBy).toBe('u1');
    expect(values.organizerName).toBe('Acme');
    expect(res.slug).toBe('tech-conference-2026');
    expect(res.status).toBe('draft');
  });

  it('appends a numeric suffix when the base slug is already taken', async () => {
    repo.existingSlugs.mockResolvedValue(['tech-conf', 'tech-conf-2']);

    const res = await service.createDraft(auth, {
      name: 'Tech Conf',
      type: 'Conference',
      startAt: new Date('2026-09-01T02:00:00Z'),
    });

    expect(res.slug).toBe('tech-conf-3');
  });

  it('keeps a caller-supplied organizer name instead of the org default', async () => {
    const res = await service.createDraft(auth, {
      name: 'Gala',
      type: 'Charity & Gala',
      startAt: new Date('2026-09-01T02:00:00Z'),
      organizerName: 'Acme Foundation',
    });

    expect(res.organizerName).toBe('Acme Foundation');
    expect(repo.organizationName).not.toHaveBeenCalled();
  });

  it('rejects a categoryId not in the caller org with 404 (no insert)', async () => {
    repo.categoryExists.mockResolvedValue(false);

    const err = await service
      .createDraft(auth, {
        name: 'Bad Category',
        type: 'Conference',
        startAt: new Date('2026-09-01T02:00:00Z'),
        categoryId: 999999,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).getStatus()).toBe(404);
    expect(repo.categoryExists).toHaveBeenCalledWith(1, 999999);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('accepts a categoryId that exists in the org and passes it to insert', async () => {
    await service.createDraft(auth, {
      name: 'Good Category',
      type: 'Conference',
      startAt: new Date('2026-09-01T02:00:00Z'),
      categoryId: 5,
    });

    expect(repo.insert.mock.calls[0][0].categoryId).toBe(5);
  });

  it('does not check a category when none is provided', async () => {
    await service.createDraft(auth, {
      name: 'No Category',
      type: 'Conference',
      startAt: new Date('2026-09-01T02:00:00Z'),
    });

    expect(repo.categoryExists).not.toHaveBeenCalled();
  });
});

describe('EventsService get/update', () => {
  let repo: jest.Mocked<EventsRepository>;
  let service: EventsService;

  const existing = eventRow({
    id: 'e1',
    name: 'Original',
    startAt: new Date('2026-09-01T02:00:00Z'),
    endAt: null,
    version: 1,
  });

  beforeEach(() => {
    repo = {
      findEvent: jest.fn().mockResolvedValue(existing),
      categoryExists: jest.fn().mockResolvedValue(true),
      update: jest
        .fn()
        .mockImplementation((_o: number, _id: string, v: Partial<EventRow>) =>
          Promise.resolve(eventRow({ ...existing, ...v, version: 2 })),
        ),
    } as unknown as jest.Mocked<EventsRepository>;
    service = new EventsService(repo);
  });

  describe('getEvent', () => {
    it('returns the event when it is in the caller org', async () => {
      const res = await service.getEvent(auth, 'e1');
      expect(repo.findEvent).toHaveBeenCalledWith(1, 'e1');
      expect(res).toMatchObject({ id: 'e1', name: 'Original' });
    });

    it('throws 404 when the event is not in the org', async () => {
      repo.findEvent.mockResolvedValue(null);
      const err = await service
        .getEvent(auth, 'missing')
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });
  });

  describe('updateEvent', () => {
    it('throws 404 when the event is not in the org', async () => {
      repo.findEvent.mockResolvedValue(null);
      const err = await service
        .updateEvent(auth, 'missing', { name: 'X' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects an end time that is not after the start (422)', async () => {
      const err = await service
        .updateEvent(auth, 'e1', { endAt: new Date('2026-09-01T01:00:00Z') })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects a stale version with 409 (changed elsewhere)', async () => {
      const err = await service
        .updateEvent(auth, 'e1', { name: 'X', version: 99 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('validates a new categoryId belongs to the org (404)', async () => {
      repo.categoryExists.mockResolvedValue(false);
      const err = await service
        .updateEvent(auth, 'e1', { categoryId: 999 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('applies changes and returns the updated event', async () => {
      const res = await service.updateEvent(auth, 'e1', {
        name: 'Renamed',
        endAt: new Date('2026-09-01T05:00:00Z'),
      });
      const [org, id, values] = repo.update.mock.calls[0];
      expect(org).toBe(1);
      expect(id).toBe('e1');
      expect(values).toMatchObject({ name: 'Renamed' });
      expect(res).toMatchObject({ name: 'Renamed', version: 2 });
    });

    it('surfaces a lost update race (repo returns null) as 409', async () => {
      repo.update.mockResolvedValue(null);
      const err = await service
        .updateEvent(auth, 'e1', { name: 'X' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
    });
  });
});
