import type { ConfigService } from '@nestjs/config';
import type { Clock } from '../../../common/time/clock';
import type { Env } from '../../../config/env.validation';
import type { PermissionsService } from '../../identity/permissions.service';
import type { EventsRepository } from '../events.repository';
import type { EventRow } from '../events.types';
import type { EventStatsPort } from '../ports/event-stats.port';
import { MonitorService } from './monitor.service';

const actor = { organizationId: 1, userId: 'u1' };
const NOW = new Date('2026-07-31T00:00:00.000Z');

function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'e1',
    slug: 'bangkok-summit',
    capacity: 100,
    startAt: new Date('2026-08-10T00:00:00.000Z'),
    ...overrides,
  } as EventRow;
}

const OVERVIEW = {
  registrations: 45,
  ticketsSold: 45,
  revenueSatang: 4_005_000,
};

describe('MonitorService', () => {
  let repo: jest.Mocked<EventsRepository>;
  let stats: jest.Mocked<EventStatsPort>;
  let permissions: jest.Mocked<PermissionsService>;
  let service: MonitorService;

  const build = (grants: string[] = []): MonitorService => {
    repo = {
      findEvent: jest.fn().mockResolvedValue(eventRow()),
    } as unknown as jest.Mocked<EventsRepository>;
    stats = {
      overview: jest.fn().mockResolvedValue(OVERVIEW),
      registrations: jest.fn(),
      attendees: jest.fn(),
    };
    permissions = {
      getFor: jest.fn().mockResolvedValue(grants),
    } as unknown as jest.Mocked<PermissionsService>;
    const clock: Clock = { now: () => NOW };
    const config = {
      getOrThrow: jest.fn().mockReturnValue('https://web.test'),
    } as unknown as ConfigService<Env, true>;
    return new MonitorService(repo, stats, permissions, clock, config);
  };

  beforeEach(() => {
    service = build();
  });

  describe('overview', () => {
    it('returns headline numbers with fill %, days-left and the public link', async () => {
      const res = await service.overview(actor, 'e1');
      expect(res).toMatchObject({
        registrations: 45,
        ticketsSold: 45,
        capacity: 100,
        fillPercent: 45,
        daysLeft: 10,
        publicUrl: 'https://web.test/e/bangkok-summit',
      });
    });

    it('hides revenue from a caller without finView', async () => {
      const res = await service.overview(actor, 'e1');
      expect(res.revenueSatang).toBeNull();
    });

    it('shows revenue to a caller with finView', async () => {
      service = build(['finView']);
      const res = await service.overview(actor, 'e1');
      expect(res.revenueSatang).toBe(4_005_000);
    });

    it('reports 0% fill when the event has no capacity', async () => {
      repo.findEvent.mockResolvedValue(eventRow({ capacity: null }));
      const res = await service.overview(actor, 'e1');
      expect(res).toMatchObject({ capacity: null, fillPercent: 0 });
    });

    it('clamps fill to 100 for an oversold event', async () => {
      repo.findEvent.mockResolvedValue(eventRow({ capacity: 100 }));
      stats.overview.mockResolvedValue({ ...OVERVIEW, registrations: 150 });
      const res = await service.overview(actor, 'e1');
      expect(res.fillPercent).toBe(100);
    });

    it('404s when the event is not in the caller org', async () => {
      repo.findEvent.mockResolvedValue(null);
      await expect(service.overview(actor, 'ghost')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(stats.overview).not.toHaveBeenCalled();
    });
  });

  describe('registrations', () => {
    it('maps rows to ISO dates and paginates with status counts', async () => {
      stats.registrations.mockResolvedValue({
        items: [
          {
            reference: 'ORD-1',
            attendeeName: 'Somchai',
            tickets: 2,
            amountSatang: 89000,
            paymentStatus: 'paid',
            registeredAt: new Date('2026-07-20T03:00:00.000Z'),
          },
        ],
        total: 42,
        statusCounts: { all: 42, paid: 30, pending: 10, refunded: 2 },
      });

      const res = await service.registrations(actor, 'e1', {
        page: 2,
        limit: 20,
        status: 'paid',
      });

      expect(stats.registrations).toHaveBeenCalledWith(1, 'e1', {
        status: 'paid',
        limit: 20,
        offset: 20,
      });
      expect(res).toMatchObject({
        page: 2,
        limit: 20,
        total: 42,
        totalPages: 3,
        statusCounts: { all: 42, paid: 30, pending: 10, refunded: 2 },
      });
      expect(res.items[0].registeredAt).toBe('2026-07-20T03:00:00.000Z');
    });

    it('404s before querying stats when the event is absent', async () => {
      repo.findEvent.mockResolvedValue(null);
      await expect(
        service.registrations(actor, 'ghost', {}),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(stats.registrations).not.toHaveBeenCalled();
    });
  });

  describe('attendees', () => {
    it('returns a Paginated page whose total is the count badge', async () => {
      stats.attendees.mockResolvedValue({
        items: [
          { name: 'Somchai', email: 's@x.com', registrations: 1, seats: 2 },
        ],
        total: 12,
      });

      const res = await service.attendees(actor, 'e1', { page: 1, limit: 20 });

      expect(stats.attendees).toHaveBeenCalledWith(1, 'e1', {
        limit: 20,
        offset: 0,
      });
      expect(res.meta).toMatchObject({ total: 12, page: 1, limit: 20 });
      expect(res.items[0].email).toBe('s@x.com');
    });
  });
});
