process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { SeatHoldRepository } from '../src/modules/registration/seat-hold.repository';
import { SeatHoldService } from '../src/modules/registration/seat-hold.service';

const ORG = { slug: 'hold-e2e', name: 'Hold E2E' };
const TTL_MS = 600_000;

describe('Seat-hold engine (US-TKT-03 reserve/hold, e2e)', () => {
  let app: INestApplication;
  let pool: Pool;
  let repo: SeatHoldRepository;
  let service: SeatHoldService;

  let orgId: number;
  let eventId: string;
  let otherEventId: string;
  let ticketTypeId: string;
  let seats: number[]; // 6 available seats
  let blockedSeat: number;
  let foreignSeat: number; // an available seat that belongs to otherEventId
  let seatMapId: number; // the event's seat map (for seats bound to a tier)

  const now = () => new Date();
  const future = (from = now()) => new Date(from.getTime() + TTL_MS);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seed();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    repo = app.get(SeatHoldRepository);
    service = app.get(SeatHoldService);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM seat_holds WHERE organization_id = $1`, [
      orgId,
    ]);
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const activeHoldsForSeat = async (seatId: number): Promise<number> => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) n FROM seat_holds WHERE seat_id = $1 AND status = 'active'`,
      [seatId],
    );
    return Number(rows[0].n);
  };

  const activeHoldsForTier = async (ticketTypeId: string): Promise<number> => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) n FROM seat_holds WHERE ticket_type_id = $1 AND status = 'active'`,
      [ticketTypeId],
    );
    return Number(rows[0].n);
  };

  describe('reserved seats', () => {
    it('holds available seats all-or-nothing with a future expiry', async () => {
      const t = now();
      const res = await repo.holdSeats(
        orgId,
        eventId,
        [seats[0], seats[1]],
        future(t),
        t,
      );

      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.holds).toHaveLength(2);
      expect(res.holds.every((h) => h.status === 'active')).toBe(true);
      expect(res.holds[0].expiresAt.getTime()).toBeGreaterThan(t.getTime());
    });

    it('refuses the whole request when one seat is already held', async () => {
      await repo.holdSeats(
        orgId,
        eventId,
        [seats[0], seats[1]],
        future(),
        now(),
      );

      const res = await repo.holdSeats(
        orgId,
        eventId,
        [seats[1], seats[2]],
        future(),
        now(),
      );

      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.unavailableSeatIds).toContain(seats[1]);
      // all-or-nothing: the free seat in the request was NOT held
      expect(await activeHoldsForSeat(seats[2])).toBe(0);
    });

    it('treats blocked, foreign-event and unknown seats as unavailable', async () => {
      const res = await repo.holdSeats(
        orgId,
        eventId,
        [blockedSeat, foreignSeat, 999_999],
        future(),
        now(),
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.unavailableSeatIds).toEqual(
        expect.arrayContaining([blockedSeat, foreignSeat, 999_999]),
      );
    });

    it('lets exactly one of two racing holds win the same seat', async () => {
      const seat = seats[3];
      const [a, b] = await Promise.all([
        repo.holdSeats(orgId, eventId, [seat], future(), now()),
        repo.holdSeats(orgId, eventId, [seat], future(), now()),
      ]);

      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(await activeHoldsForSeat(seat)).toBe(1);
    });

    it('self-heals an expired hold: the seat can be held again', async () => {
      const seat = seats[4];
      await pool.query(
        `INSERT INTO seat_holds (organization_id, event_id, seat_id, quantity, status, expires_at)
         VALUES ($1, $2, $3, 1, 'active', now() - interval '1 minute')`,
        [orgId, eventId, seat],
      );

      const res = await repo.holdSeats(orgId, eventId, [seat], future(), now());

      expect(res.ok).toBe(true);
      expect(await activeHoldsForSeat(seat)).toBe(1);
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) n FROM seat_holds WHERE seat_id = $1 AND status = 'expired'`,
        [seat],
      );
      expect(Number(rows[0].n)).toBe(1);
    });

    it('frees a released seat for a new hold', async () => {
      const seat = seats[5];
      const held = await repo.holdSeats(
        orgId,
        eventId,
        [seat],
        future(),
        now(),
      );
      expect(held.ok).toBe(true);
      if (!held.ok) return;

      await repo.release(
        orgId,
        held.holds.map((h) => h.id),
      );
      expect(await activeHoldsForSeat(seat)).toBe(0);

      const again = await repo.holdSeats(
        orgId,
        eventId,
        [seat],
        future(),
        now(),
      );
      expect(again.ok).toBe(true);
    });
  });

  describe('general admission quantity', () => {
    it('holds up to capacity, then refuses with the remaining count', async () => {
      const first = await repo.holdQuantity(
        orgId,
        eventId,
        ticketTypeId,
        2,
        future(),
        now(),
      );
      expect(first.ok).toBe(true);

      const second = await repo.holdQuantity(
        orgId,
        eventId,
        ticketTypeId,
        2,
        future(),
        now(),
      );
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.available).toBe(1); // total 3 − sold 0 − held 2
    });

    it('never oversells under concurrent GA holds', async () => {
      const [a, b] = await Promise.all([
        repo.holdQuantity(orgId, eventId, ticketTypeId, 2, future(), now()),
        repo.holdQuantity(orgId, eventId, ticketTypeId, 2, future(), now()),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    });
  });

  describe('expiry sweep', () => {
    it('flips lapsed active holds to expired', async () => {
      await pool.query(
        `INSERT INTO seat_holds (organization_id, event_id, seat_id, quantity, status, expires_at)
         VALUES ($1, $2, $3, 1, 'active', now() - interval '5 minutes')`,
        [orgId, eventId, seats[0]],
      );
      const swept = await repo.expireStale(orgId, now());
      expect(swept).toBeGreaterThanOrEqual(1);
      expect(await activeHoldsForSeat(seats[0])).toBe(0);
    });
  });

  describe('service rules over the engine', () => {
    it('rejects a 9-seat booking before touching the database (422)', async () => {
      await expect(
        service.holdSeats(
          { organizationId: orgId },
          { eventId, seatIds: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('maps a taken seat to a 409 conflict', async () => {
      await service.holdSeats(
        { organizationId: orgId },
        { eventId, seatIds: [seats[0]] },
      );
      await expect(
        service.holdSeats(
          { organizationId: orgId },
          { eventId, seatIds: [seats[0]] },
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  // Defence-in-depth for direct repo callers (the checkout slice calls it directly),
  // hardened after the adversarial review of this engine.
  describe('direct-repo robustness (review findings)', () => {
    it('dedupes repeated seat ids instead of hitting the unique index (no 500)', async () => {
      const res = await repo.holdSeats(
        orgId,
        eventId,
        [seats[0], seats[0]],
        future(),
        now(),
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.holds).toHaveLength(1);
      expect(await activeHoldsForSeat(seats[0])).toBe(1);
    });

    it('returns a clean conflict for an empty seat list (no 500)', async () => {
      const res = await repo.holdSeats(orgId, eventId, [], future(), now());
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.unavailableSeatIds).toEqual([]);
    });

    it('refuses a non-positive GA quantity without corrupting availability', async () => {
      const bad = await repo.holdQuantity(
        orgId,
        eventId,
        ticketTypeId,
        -3,
        future(),
        now(),
      );
      expect(bad.ok).toBe(false);
      // availability is intact: the full total is still reservable
      const full = await repo.holdQuantity(
        orgId,
        eventId,
        ticketTypeId,
        3,
        future(),
        now(),
      );
      expect(full.ok).toBe(true);
    });

    it('enforces a seat_holds.quantity >= 1 CHECK at the database', async () => {
      await expect(
        pool.query(
          `INSERT INTO seat_holds (organization_id, event_id, ticket_type_id, quantity, status, expires_at)
           VALUES ($1, $2, $3, 0, 'active', now() + interval '10 minutes')`,
          [orgId, eventId, ticketTypeId],
        ),
      ).rejects.toThrow();
    });
  });

  // The service composes the real Ticketing sales-eligibility port + policy against
  // the DB — a tier must be on sale, inside its window, and within per-order bounds
  // before the concurrency engine runs (US-TKT-03).
  describe('per-tier sales eligibility (service path, US-TKT-03)', () => {
    const actor = () => ({ organizationId: orgId });
    const isoOffset = (ms: number) => new Date(Date.now() + ms).toISOString();

    it('holds a GA quantity when the tier is on sale and within bounds', async () => {
      const tier = await insertTier({ name: 'Elig-OK', total: 5 });
      const hold = await service.holdQuantity(actor(), {
        eventId,
        ticketTypeId: tier,
        quantity: 2,
      });
      expect(hold.status).toBe('active');
    });

    it('409s a paused tier before reserving', async () => {
      const tier = await insertTier({ name: 'Elig-Paused', status: 'paused' });
      await expect(
        service.holdQuantity(actor(), {
          eventId,
          ticketTypeId: tier,
          quantity: 1,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await activeHoldsForTier(tier)).toBe(0);
    });

    it('409s a tier whose sales window has ended', async () => {
      const tier = await insertTier({
        name: 'Elig-Ended',
        salesEndAt: isoOffset(-60_000),
      });
      await expect(
        service.holdQuantity(actor(), {
          eventId,
          ticketTypeId: tier,
          quantity: 1,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('409s a tier whose sales window has not opened', async () => {
      const tier = await insertTier({
        name: 'Elig-NotOpen',
        salesStartAt: isoOffset(60_000),
      });
      await expect(
        service.holdQuantity(actor(), {
          eventId,
          ticketTypeId: tier,
          quantity: 1,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('422s a quantity above maxPerOrder even within the global cap', async () => {
      const tier = await insertTier({
        name: 'Elig-Max',
        total: 10,
        maxPerOrder: 2,
      });
      await expect(
        service.holdQuantity(actor(), {
          eventId,
          ticketTypeId: tier,
          quantity: 3,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await activeHoldsForTier(tier)).toBe(0);
    });

    it('422s a quantity below minPerOrder', async () => {
      const tier = await insertTier({ name: 'Elig-Min', minPerOrder: 3 });
      await expect(
        service.holdQuantity(actor(), {
          eventId,
          ticketTypeId: tier,
          quantity: 1,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('404s an unknown tier', async () => {
      await expect(
        service.holdQuantity(actor(), {
          eventId,
          ticketTypeId: '00000000-0000-0000-0000-000000000000',
          quantity: 1,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('409s reserving a seat whose tier is not on sale', async () => {
      const tier = await insertTier({ name: 'Seat-Paused', status: 'paused' });
      const seatId = await insertSeat(seatMapId, 'GATE1', 'available', tier);
      await expect(
        service.holdSeats(actor(), { eventId, seatIds: [seatId] }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await activeHoldsForSeat(seatId)).toBe(0);
    });

    it('reserves a seat whose tier is on sale', async () => {
      const tier = await insertTier({ name: 'Seat-OK' });
      const seatId = await insertSeat(seatMapId, 'GATE2', 'available', tier);
      const holds = await service.holdSeats(actor(), {
        eventId,
        seatIds: [seatId],
      });
      expect(holds).toHaveLength(1);
    });
  });

  async function seed(): Promise<void> {
    const org = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [ORG.name, ORG.slug],
    );
    orgId = Number(org.rows[0].id);
    eventId = await insertEvent('reserved-ev', 'Reserved Ev');
    otherEventId = await insertEvent('other-ev', 'Other Ev');

    const mapId = await insertSeatMap(eventId);
    seatMapId = mapId;
    seats = [];
    for (let i = 1; i <= 6; i += 1) {
      seats.push(await insertSeat(mapId, `A${i}`, 'available'));
    }
    blockedSeat = await insertSeat(mapId, 'A7', 'blocked');

    const otherMap = await insertSeatMap(otherEventId);
    foreignSeat = await insertSeat(otherMap, 'B1', 'available');

    const tt = await pool.query<{ id: string }>(
      `INSERT INTO ticket_types (organization_id, event_id, name, total, sold, status)
       VALUES ($1, $2, 'GA', 3, 0, 'onsale') RETURNING id`,
      [orgId, eventId],
    );
    ticketTypeId = tt.rows[0].id;
  }

  async function insertEvent(slug: string, name: string): Promise<string> {
    const ev = await pool.query<{ id: string }>(
      `INSERT INTO events (organization_id, slug, name, type, bucket, start_at, organizer_name, seating_mode)
       VALUES ($1, $2, $3, 'Conference', 'active', '2026-09-01T02:00:00Z', 'Acme', 'reserved')
       RETURNING id`,
      [orgId, slug, name],
    );
    return ev.rows[0].id;
  }

  async function insertSeatMap(forEvent: string): Promise<number> {
    const map = await pool.query<{ id: string }>(
      `INSERT INTO seat_maps (organization_id, event_id, name, total_seats)
       VALUES ($1, $2, 'Main', 6) RETURNING id`,
      [orgId, forEvent],
    );
    return Number(map.rows[0].id);
  }

  async function insertSeat(
    mapId: number,
    seatNumber: string,
    status: string,
    ticketTypeId: string | null = null,
  ): Promise<number> {
    const seat = await pool.query<{ id: string }>(
      `INSERT INTO seats (organization_id, seat_map_id, seat_number, status, ticket_type_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, mapId, seatNumber, status, ticketTypeId],
    );
    return Number(seat.rows[0].id);
  }

  async function insertTier(opts: {
    name: string;
    status?: string;
    total?: number;
    salesStartAt?: string | null;
    salesEndAt?: string | null;
    minPerOrder?: number;
    maxPerOrder?: number;
  }): Promise<string> {
    const tt = await pool.query<{ id: string }>(
      `INSERT INTO ticket_types
         (organization_id, event_id, name, total, sold, status,
          sales_start_at, sales_end_at, min_per_order, max_per_order)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9) RETURNING id`,
      [
        orgId,
        eventId,
        opts.name,
        opts.total ?? 5,
        opts.status ?? 'onsale',
        opts.salesStartAt ?? null,
        opts.salesEndAt ?? null,
        opts.minPerOrder ?? 1,
        opts.maxPerOrder ?? 8,
      ],
    );
    return tt.rows[0].id;
  }
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
