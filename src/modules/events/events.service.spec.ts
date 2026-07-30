import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import { OutboxPort } from '../platform/outbox.port';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import { TicketAvailabilityPort } from './ports/ticket-availability.port';
import type { EventRow } from './events.types';

const auth = { organizationId: 1, userId: 'u1' };
const NOW = new Date('2026-07-29T00:00:00Z');

/** Collaborators the publish/unpublish paths need, with sensible test defaults. */
function makeDeps() {
  return {
    tickets: {
      activeCount: jest.fn().mockResolvedValue(1),
      totalQuantity: jest.fn().mockResolvedValue(0),
      soldCount: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<TicketAvailabilityPort>,
    outbox: {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OutboxPort>,
    clock: {
      now: jest.fn().mockReturnValue(NOW),
    } as unknown as jest.Mocked<Clock>,
  };
}

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
    const deps = makeDeps();
    service = new EventsService(repo, deps.tickets, deps.outbox, deps.clock);
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
    const deps = makeDeps();
    service = new EventsService(repo, deps.tickets, deps.outbox, deps.clock);
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

describe('EventsService publish/unpublish', () => {
  let repo: jest.Mocked<EventsRepository>;
  let deps: ReturnType<typeof makeDeps>;
  let service: EventsService;

  /** A draft that satisfies every publish requirement. */
  const ready = eventRow({
    id: 'e1',
    name: 'Ready Event',
    description: 'A great event',
    status: 'draft',
    visibility: 'private',
    venueName: 'Hall A',
    startAt: new Date('2026-09-01T02:00:00Z'), // future vs NOW (2026-07-29)
    publishedAt: null,
    version: 3,
  });

  function build(event: EventRow): void {
    repo = {
      findEvent: jest.fn().mockResolvedValue(event),
      update: jest
        .fn()
        .mockImplementation((_o: number, _id: string, v: Partial<EventRow>) =>
          Promise.resolve(
            eventRow({ ...event, ...v, version: event.version + 1 }),
          ),
        ),
    } as unknown as jest.Mocked<EventsRepository>;
    deps = makeDeps();
    service = new EventsService(repo, deps.tickets, deps.outbox, deps.clock);
  }

  describe('publishEvent', () => {
    beforeEach(() => build(ready));

    it('publishes a complete draft: upcoming, published_at, visibility, template, notice', async () => {
      const res = await service.publishEvent(auth, 'e1', {
        visibility: 'public',
        landingTemplateId: 'aurora',
      });

      const [, , values] = repo.update.mock.calls[0];
      expect(values).toMatchObject({
        status: 'upcoming',
        bucket: 'active',
        visibility: 'public',
        landingTemplateId: 'aurora',
        publishedAt: NOW,
      });
      expect(deps.outbox.enqueue).toHaveBeenCalledTimes(1);
      expect(deps.outbox.enqueue.mock.calls[0][0].routingKey).toBe(
        'events.published',
      );
      expect(res.status).toBe('upcoming');
    });

    it('blocks publish and flags the missing items (422) — no write, no notice', async () => {
      build(eventRow({ ...ready, description: null }));
      deps.tickets.activeCount.mockResolvedValue(0);

      const err = await service
        .publishEvent(auth, 'e1', {})
        .catch((e: unknown) => e);

      expect((err as DomainException).getStatus()).toBe(422);
      expect((err as DomainException).message).toMatch(/description/i);
      expect((err as DomainException).message).toMatch(/ticket/i);
      expect(repo.update).not.toHaveBeenCalled();
      expect(deps.outbox.enqueue).not.toHaveBeenCalled();
    });

    it('treats an online event with no venue as having a location', async () => {
      build(eventRow({ ...ready, venueName: null, isOnline: true }));
      await expect(service.publishEvent(auth, 'e1', {})).resolves.toBeDefined();
    });

    it('asks to confirm a past start date (422), then publishes when confirmed', async () => {
      build(eventRow({ ...ready, startAt: new Date('2026-06-01T02:00:00Z') }));

      const err = await service
        .publishEvent(auth, 'e1', {})
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect((err as DomainException).message).toMatch(/past/i);
      expect(repo.update).not.toHaveBeenCalled();

      await expect(
        service.publishEvent(auth, 'e1', { confirmPastStart: true }),
      ).resolves.toBeDefined();
      expect(repo.update).toHaveBeenCalledTimes(1);
    });

    it('rejects publishing an event that is not a draft (409)', async () => {
      build(eventRow({ ...ready, status: 'upcoming' }));
      const err = await service
        .publishEvent(auth, 'e1', {})
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects a stale version (409) before doing any work', async () => {
      const err = await service
        .publishEvent(auth, 'e1', { version: 99 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(deps.tickets.activeCount).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the event is not in the caller org', async () => {
      repo.findEvent.mockResolvedValue(null);
      const err = await service
        .publishEvent(auth, 'missing', {})
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });
  });

  describe('unpublishEvent', () => {
    it('reverts a published event to a private draft and clears published_at', async () => {
      build(
        eventRow({
          ...ready,
          status: 'upcoming',
          visibility: 'public',
          publishedAt: NOW,
        }),
      );

      const res = await service.unpublishEvent(auth, 'e1', {});

      const [, , values] = repo.update.mock.calls[0];
      expect(values).toMatchObject({
        status: 'draft',
        visibility: 'private',
        publishedAt: null,
      });
      expect(res.status).toBe('draft');
    });

    it('rejects unpublishing a draft (409 — not published)', async () => {
      build(ready);
      const err = await service
        .unpublishEvent(auth, 'e1', {})
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });
});

describe('EventsService delete/cancel', () => {
  let repo: jest.Mocked<EventsRepository>;
  let deps: ReturnType<typeof makeDeps>;
  let service: EventsService;

  function build(event: EventRow): void {
    repo = {
      findEvent: jest.fn().mockResolvedValue(event),
      hardDelete: jest.fn().mockResolvedValue(undefined),
      update: jest
        .fn()
        .mockImplementation((_o: number, _id: string, v: Partial<EventRow>) =>
          Promise.resolve(
            eventRow({ ...event, ...v, version: event.version + 1 }),
          ),
        ),
    } as unknown as jest.Mocked<EventsRepository>;
    deps = makeDeps();
    service = new EventsService(repo, deps.tickets, deps.outbox, deps.clock);
  }

  describe('deleteEvent', () => {
    it('permanently removes a draft with no sales', async () => {
      build(eventRow({ status: 'draft' }));
      deps.tickets.soldCount.mockResolvedValue(0);
      await service.deleteEvent(auth, 'e1', {});
      expect(repo.hardDelete).toHaveBeenCalledWith(1, 'e1');
    });

    it('blocks deleting a published event and routes to cancel (409)', async () => {
      build(eventRow({ status: 'upcoming' }));
      const err = await service
        .deleteEvent(auth, 'e1', {})
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it('blocks deleting a draft that has registrations (409)', async () => {
      build(eventRow({ status: 'draft' }));
      deps.tickets.soldCount.mockResolvedValue(5);
      const err = await service
        .deleteEvent(auth, 'e1', {})
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect((err as DomainException).message).toMatch(/cancel/i);
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });

    it('throws 404 when the event is not in the org', async () => {
      build(eventRow());
      repo.findEvent.mockResolvedValue(null);
      const err = await service
        .deleteEvent(auth, 'missing', {})
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });

    it('rejects a stale version (409)', async () => {
      build(eventRow({ status: 'draft', version: 3 }));
      const err = await service
        .deleteEvent(auth, 'e1', { version: 99 })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.hardDelete).not.toHaveBeenCalled();
    });
  });

  describe('cancelEvent', () => {
    it('cancels: moves out of Active, stamps cancelledAt, and notifies', async () => {
      build(eventRow({ status: 'upcoming', version: 2 }));
      const res = await service.cancelEvent(auth, 'e1', {
        reason: 'Venue flooded',
      });
      const [, , values] = repo.update.mock.calls[0];
      expect(values).toMatchObject({
        status: 'cancelled',
        bucket: 'completed',
      });
      expect(values.cancelledAt).toBeInstanceOf(Date);
      expect(deps.outbox.enqueue).toHaveBeenCalledTimes(1);
      expect(deps.outbox.enqueue.mock.calls[0][0].routingKey).toBe(
        'events.cancelled',
      );
      expect(res.status).toBe('cancelled');
    });

    it('requires a non-blank reason (422)', async () => {
      build(eventRow({ status: 'upcoming' }));
      const err = await service
        .cancelEvent(auth, 'e1', { reason: '   ' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(422);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects cancelling an already-cancelled event (409)', async () => {
      build(eventRow({ status: 'cancelled' }));
      const err = await service
        .cancelEvent(auth, 'e1', { reason: 'x' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(409);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('throws 404 when the event is not in the org', async () => {
      build(eventRow());
      repo.findEvent.mockResolvedValue(null);
      const err = await service
        .cancelEvent(auth, 'missing', { reason: 'x' })
        .catch((e: unknown) => e);
      expect((err as DomainException).getStatus()).toBe(404);
    });
  });
});
