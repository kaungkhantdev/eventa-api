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
});
