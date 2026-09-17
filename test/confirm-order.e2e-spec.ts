process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';

const ORG = { slug: 'confirm-e2e', name: 'Confirm E2E' };
const FREE = 'cfm-free-meetup';
const PAID = 'cfm-paid-summit';
const GALA = 'cfm-gala-dinner';
const BAHT = 100;

interface Success<T> {
  data: T;
}
interface Placed {
  orderId: string;
  reference: string;
  status: string;
  paymentStatus: string;
  eventName: string;
  totalSatang: number;
  vatSatang: number;
  paymentRequired: boolean;
  tickets: { id: string; qrToken: string; ticketLabel: string | null }[];
}
interface Held {
  holdIds: number[];
}

describe('Confirming a registration (e2e — US-DISC-06)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let ids: {
    orgId: number;
    events: Record<string, string>;
    tiers: Record<string, string>;
    seats: number[];
  };
  let keySeq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    ids = await seed(pool);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;
  }, 30000);

  afterEach(async () => {
    await pool.query(`DELETE FROM orders WHERE organization_id = $1`, [
      ids.orgId,
    ]);
    await pool.query(`DELETE FROM seat_holds WHERE organization_id = $1`, [
      ids.orgId,
    ]);
    await pool.query(`DELETE FROM outbox_events WHERE organization_id = $1`, [
      ids.orgId,
    ]);
    await pool.query(
      `UPDATE ticket_types SET sold = 0 WHERE organization_id = $1`,
      [ids.orgId],
    );
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const nextKey = () => {
    keySeq += 1;
    return `idem-key-${keySeq}-${ORG.slug}`;
  };

  const hold = async (body: object): Promise<number[]> => {
    const res = await request(server)
      .post('/api/v1/public/checkout/hold')
      .send(body);
    expect(res.status).toBe(201);
    return (res.body as Success<Held>).data.holdIds;
  };

  const confirm = (body: object) =>
    request(server).post('/api/v1/public/checkout/confirm').send(body);

  const buyer = {
    name: 'Anan Suksawat',
    email: 'anan@example.test',
    phone: '+66812345678',
  };

  const soldFor = async (tierId: string): Promise<number> => {
    const { rows } = await pool.query<{ sold: number }>(
      `SELECT sold FROM ticket_types WHERE id = $1`,
      [tierId],
    );
    return rows[0].sold;
  };

  const orderCount = async (): Promise<number> => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM orders WHERE organization_id = $1`,
      [ids.orgId],
    );
    return Number(rows[0].n);
  };

  describe('a free registration completes on the spot', () => {
    const placeFree = async (quantity = 2, idempotencyKey = nextKey()) => {
      const holdIds = await hold({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity,
      });
      return confirm({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity,
        holdIds,
        buyer,
        idempotencyKey,
      });
    };

    it('places the order and issues one QR ticket per admission', async () => {
      const res = await placeFree(2);
      expect(res.status).toBe(201);
      const p = (res.body as Success<Placed>).data;
      expect(p.status).toBe('confirmed');
      expect(p.paymentStatus).toBe('paid');
      expect(p.paymentRequired).toBe(false);
      expect(p.totalSatang).toBe(0);
      expect(p.tickets).toHaveLength(2);
      expect(p.tickets[0].ticketLabel).toBe('RSVP');
    });

    it('gives a reference a person can read down a phone line', async () => {
      const p = (await placeFree()).body as Success<Placed>;
      expect(p.data.reference).toMatch(/^ORD-[0-9A-HJKMNP-TV-Z]{8}$/);
    });

    it('mints a distinct, unguessable QR token per ticket', async () => {
      const p = ((await placeFree(3)).body as Success<Placed>).data;
      const tokens = new Set(p.tickets.map((t) => t.qrToken));
      expect(tokens.size).toBe(3);
      for (const token of tokens) expect(token).toHaveLength(24);
    });

    it('counts the admissions against the tier', async () => {
      await placeFree(2);
      expect(await soldFor(ids.tiers.free)).toBe(2);
    });

    it('queues the confirmation for the worker, in the same transaction', async () => {
      const p = ((await placeFree()).body as Success<Placed>).data;
      const { rows } = await pool.query<{
        routing_key: string;
        aggregate_id: string;
        payload: { ticketCount: number; buyerPhone: string; paid: boolean };
      }>(
        `SELECT routing_key, aggregate_id, payload FROM outbox_events
         WHERE organization_id = $1`,
        [ids.orgId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].routing_key).toBe('registration.confirmed');
      expect(rows[0].aggregate_id).toBe(p.orderId);
      expect(rows[0].payload.ticketCount).toBe(2);
      expect(rows[0].payload.buyerPhone).toBe(buyer.phone);
      // A free RSVP gets a confirmation, not a VAT receipt.
      expect(rows[0].payload.paid).toBe(false);
    });

    it('never puts a QR token on the message bus', async () => {
      const p = ((await placeFree()).body as Success<Placed>).data;
      const { rows } = await pool.query<{ payload: unknown }>(
        `SELECT payload FROM outbox_events WHERE organization_id = $1`,
        [ids.orgId],
      );
      const serialized = JSON.stringify(rows[0].payload);
      for (const ticket of p.tickets) {
        expect(serialized).not.toContain(ticket.qrToken);
      }
    });

    it('records the buyer in the workspace’s attendee list, once', async () => {
      await placeFree();
      await placeFree();
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM attendees
         WHERE organization_id = $1 AND email = $2`,
        [ids.orgId, buyer.email],
      );
      expect(Number(rows[0].n)).toBe(1);
    });

    it('creates no account for a guest who did not ask for one', async () => {
      await placeFree();
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM users WHERE email = $1`,
        [buyer.email],
      );
      expect(Number(rows[0].n)).toBe(0);
    });
  });

  /**
   * The guest's own copy of the order (US-DISC-06/07).
   *
   * Registration never requires an account, so the person who just paid has to
   * be able to see what they bought without signing in to one. The order's uuid
   * IS the capability — the same one the confirmation email already links to
   * via `ticketsUrlFor` — so the link is the credential and nothing else is.
   */
  describe('looking up an order without an account', () => {
    const viewOrder = (orderId: string) =>
      request(server).get(`/api/v1/public/orders/${orderId}`);

    const placeFreeOrder = async (quantity = 2) => {
      const holdIds = await hold({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity,
      });
      const res = await confirm({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity,
        holdIds,
        buyer,
        idempotencyKey: nextKey(),
      });
      return (res.body as Success<Placed>).data;
    };

    it('shows the order to whoever holds its id, with no session', async () => {
      const placed = await placeFreeOrder(2);

      const res = await viewOrder(placed.orderId);

      expect(res.status).toBe(200);
      const view = (res.body as Success<Placed>).data;
      expect(view.reference).toBe(placed.reference);
      expect(view.eventName).toBe(placed.eventName);
      expect(view.status).toBe('confirmed');
    });

    it('hands over the tickets, so the QR can be shown at the door', async () => {
      const placed = await placeFreeOrder(2);

      const view = ((await viewOrder(placed.orderId)).body as Success<Placed>)
        .data;

      expect(view.tickets).toHaveLength(2);
      expect(view.tickets.map((t) => t.qrToken).sort()).toEqual(
        placed.tickets.map((t) => t.qrToken).sort(),
      );
    });

    it('reports the totals the buyer actually paid', async () => {
      const placed = await placeFreeOrder(1);
      const view = ((await viewOrder(placed.orderId)).body as Success<Placed>)
        .data;
      expect(view.totalSatang).toBe(placed.totalSatang);
      expect(view.vatSatang).toBe(placed.vatSatang);
    });

    // An unpaid order has no tickets yet; the page still has to render, because
    // that is exactly when somebody goes looking for it.
    it('shows a pending order, with no tickets and the money still owed', async () => {
      const holdIds = await hold({
        eventId: ids.events[PAID],
        ticketTypeId: ids.tiers.paid,
        quantity: 1,
      });
      const placed = (
        (
          await confirm({
            eventId: ids.events[PAID],
            ticketTypeId: ids.tiers.paid,
            quantity: 1,
            holdIds,
            buyer,
            idempotencyKey: nextKey(),
          })
        ).body as Success<Placed>
      ).data;

      const view = ((await viewOrder(placed.orderId)).body as Success<Placed>)
        .data;

      expect(view.status).toBe('pending');
      expect(view.paymentRequired).toBe(true);
      expect(view.tickets).toEqual([]);
    });

    // The uuid is the credential. A wrong one must not distinguish "no such
    // order" from "not yours" — both are simply not found.
    it('404s an id that is not an order', async () => {
      await viewOrder('3f1b7c9e-0000-4000-8000-000000000000').expect(404);
    });

    it('rejects an id that is not a uuid rather than searching for it', async () => {
      await viewOrder('ORD-27VEEC7Y').expect(400);
    });
  });

  describe('confirming twice', () => {
    it('returns the first registration rather than placing a second', async () => {
      const key = nextKey();
      const holdIds = await hold({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 2,
      });
      const body = {
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 2,
        holdIds,
        buyer,
        idempotencyKey: key,
      };
      const first = (await confirm(body)).body as Success<Placed>;
      const second = await confirm(body);

      expect(second.status).toBe(201);
      const replay = (second.body as Success<Placed>).data;
      expect(replay.orderId).toBe(first.data.orderId);
      expect(replay.reference).toBe(first.data.reference);
      expect(replay.tickets.map((t) => t.qrToken)).toEqual(
        first.data.tickets.map((t) => t.qrToken),
      );
      expect(await orderCount()).toBe(1);
      // Crucially, the tier is not counted twice.
      expect(await soldFor(ids.tiers.free)).toBe(2);
    });

    it('places a genuinely separate order under a different key', async () => {
      const first = await hold({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 1,
      });
      await confirm({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 1,
        holdIds: first,
        buyer,
        idempotencyKey: nextKey(),
      });
      const second = await hold({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 1,
      });
      const res = await confirm({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 1,
        holdIds: second,
        buyer,
        idempotencyKey: nextKey(),
      });
      expect(res.status).toBe(201);
      expect(await orderCount()).toBe(2);
      expect(await soldFor(ids.tiers.free)).toBe(2);
    });
  });

  describe('a paid registration waits for the money', () => {
    it('is placed as pending, with no ticket issued yet', async () => {
      const holdIds = await hold({
        eventId: ids.events[PAID],
        ticketTypeId: ids.tiers.paid,
        quantity: 2,
      });
      const res = await confirm({
        eventId: ids.events[PAID],
        ticketTypeId: ids.tiers.paid,
        quantity: 2,
        holdIds,
        buyer,
        idempotencyKey: nextKey(),
      });
      expect(res.status).toBe(201);
      const p = (res.body as Success<Placed>).data;
      expect(p.status).toBe('pending');
      expect(p.paymentStatus).toBe('pending');
      expect(p.paymentRequired).toBe(true);
      expect(p.tickets).toEqual([]);
      expect(p.totalSatang).toBe(2_100 * BAHT); // ฿1,000 x2 + 5% fee
      expect(p.vatSatang).toBeGreaterThan(0);
    });

    it('does not count an unpaid order against the allocation', async () => {
      const holdIds = await hold({
        eventId: ids.events[PAID],
        ticketTypeId: ids.tiers.paid,
        quantity: 2,
      });
      await confirm({
        eventId: ids.events[PAID],
        ticketTypeId: ids.tiers.paid,
        quantity: 2,
        holdIds,
        buyer,
        idempotencyKey: nextKey(),
      });
      expect(await soldFor(ids.tiers.paid)).toBe(0);
    });

    it('queues no confirmation until the money arrives', async () => {
      const holdIds = await hold({
        eventId: ids.events[PAID],
        ticketTypeId: ids.tiers.paid,
        quantity: 1,
      });
      await confirm({
        eventId: ids.events[PAID],
        ticketTypeId: ids.tiers.paid,
        quantity: 1,
        holdIds,
        buyer,
        idempotencyKey: nextKey(),
      });
      const { rows } = await pool.query(
        `SELECT 1 FROM outbox_events WHERE organization_id = $1`,
        [ids.orgId],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('when the reservation has gone', () => {
    it('refuses, and charges nothing, once the hold has lapsed', async () => {
      const holdIds = await hold({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 2,
      });
      await pool.query(
        `UPDATE seat_holds SET expires_at = now() - interval '1 minute'
         WHERE id = ANY($1)`,
        [holdIds],
      );
      const res = await confirm({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 2,
        holdIds,
        buyer,
        idempotencyKey: nextKey(),
      });
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(
        /released|choose again/i,
      );
      expect(await orderCount()).toBe(0);
      expect(await soldFor(ids.tiers.free)).toBe(0);
    });

    it('refuses a hold the buyer already gave back', async () => {
      const holdIds = await hold({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 1,
      });
      await request(server)
        .delete('/api/v1/public/checkout/hold')
        .send({ eventId: ids.events[FREE], holdIds });
      const res = await confirm({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 1,
        holdIds,
        buyer,
        idempotencyKey: nextKey(),
      });
      expect(res.status).toBe(409);
      expect(await orderCount()).toBe(0);
    });
  });

  describe('reserved seating', () => {
    it('binds each ticket to its seat', async () => {
      const seatIds = ids.seats.slice(0, 2);
      const holdIds = await hold({
        eventId: ids.events[GALA],
        ticketTypeId: ids.tiers.gala,
        seatIds,
      });
      const res = await confirm({
        eventId: ids.events[GALA],
        ticketTypeId: ids.tiers.gala,
        seatIds,
        holdIds,
        buyer,
        idempotencyKey: nextKey(),
      });
      expect(res.status).toBe(201);
      const { rows } = await pool.query<{ seat_id: string }>(
        `SELECT sa.seat_id FROM seat_assignments sa
         JOIN tickets t ON t.id = sa.ticket_id
         WHERE t.order_id = $1 ORDER BY sa.seat_id`,
        [(res.body as Success<Placed>).data.orderId],
      );
      expect(rows.map((r) => Number(r.seat_id))).toEqual(
        [...seatIds].sort((a, b) => a - b),
      );
    });

    it('gives a seat to the first buyer only, and charges no one else', async () => {
      const seatIds = ids.seats.slice(0, 1);
      const body = (holdIds: number[]) => ({
        eventId: ids.events[GALA],
        ticketTypeId: ids.tiers.gala,
        seatIds,
        holdIds,
        buyer,
        idempotencyKey: nextKey(),
      });
      const firstHold = await hold({
        eventId: ids.events[GALA],
        ticketTypeId: ids.tiers.gala,
        seatIds,
      });
      expect((await confirm(body(firstHold))).status).toBe(201);

      // The second buyer cannot even reserve the seat, let alone be charged.
      const second = await request(server)
        .post('/api/v1/public/checkout/hold')
        .send({
          eventId: ids.events[GALA],
          ticketTypeId: ids.tiers.gala,
          seatIds,
        });
      expect(second.status).toBe(409);
      expect(await orderCount()).toBe(1);
    });
  });

  describe('the selection is re-checked, never trusted', () => {
    it('refuses an order for an event that does not exist', async () => {
      const res = await confirm({
        eventId: '00000000-0000-4000-8000-0000000000ff',
        ticketTypeId: ids.tiers.free,
        quantity: 1,
        holdIds: [],
        buyer,
        idempotencyKey: nextKey(),
      });
      expect(res.status).toBe(404);
    });

    it('rejects a request with no idempotency key', async () => {
      const res = await confirm({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 1,
        holdIds: [],
        buyer,
      });
      expect(res.status).toBe(400);
    });

    it('rejects a buyer with no usable email', async () => {
      const res = await confirm({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 1,
        holdIds: [],
        buyer: { name: 'Anan', email: 'not-an-email' },
        idempotencyKey: nextKey(),
      });
      expect(res.status).toBe(400);
    });
  });
});

async function seed(pool: Pool): Promise<{
  orgId: number;
  events: Record<string, string>;
  tiers: Record<string, string>;
  seats: number[];
}> {
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, vat_rate, service_fee_rate)
     VALUES ($1,$2,0.0700,0.0500) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(org.rows[0].id);
  const events: Record<string, string> = {};
  const tiers: Record<string, string> = {};

  events[FREE] = await insertEvent(pool, orgId, FREE, 'Free Meetup');
  tiers.free = await insertTier(pool, orgId, events[FREE], {
    name: 'RSVP',
    price: 0,
    isFree: true,
    total: 100,
  });

  events[PAID] = await insertEvent(pool, orgId, PAID, 'Paid Summit');
  tiers.paid = await insertTier(pool, orgId, events[PAID], {
    name: 'General',
    price: 1_000 * BAHT,
    total: 100,
  });

  events[GALA] = await insertEvent(
    pool,
    orgId,
    GALA,
    'Gala Dinner',
    'reserved',
  );
  tiers.gala = await insertTier(pool, orgId, events[GALA], {
    name: 'Table',
    price: 0,
    isFree: true,
    total: 20,
  });
  const seats = await insertSeats(pool, orgId, events[GALA], tiers.gala);
  return { orgId, events, tiers, seats };
}

async function insertEvent(
  pool: Pool,
  orgId: number,
  slug: string,
  name: string,
  seatingMode = 'ga',
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, venue_name, city,
                         seating_mode, published_at)
     VALUES ($1,$2,$3,'Conference','active','upcoming','public',
             now() + interval '30 days','Asia/Bangkok','Acme Events','QSNCC','Bangkok',
             $4, now())
     RETURNING id`,
    [orgId, slug, name, seatingMode],
  );
  return res.rows[0].id;
}

async function insertTier(
  pool: Pool,
  orgId: number,
  eventId: string,
  t: { name: string; price: number; total: number; isFree?: boolean },
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang, is_free,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,$3,$4,$5,'onsale',$6,0,1,8) RETURNING id`,
    [orgId, eventId, t.name, t.price, t.isFree ?? false, t.total],
  );
  return res.rows[0].id;
}

async function insertSeats(
  pool: Pool,
  orgId: number,
  eventId: string,
  ticketTypeId: string,
): Promise<number[]> {
  const map = await pool.query<{ id: string }>(
    `INSERT INTO seat_maps (organization_id, event_id, name, total_seats)
     VALUES ($1,$2,'Main',4) RETURNING id`,
    [orgId, eventId],
  );
  const mapId = Number(map.rows[0].id);
  const ids: number[] = [];
  for (let n = 1; n <= 4; n += 1) {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO seats (organization_id, seat_map_id, section, row_label,
                          seat_number, ticket_type_id, status)
       VALUES ($1,$2,'Stalls','A',$3,$4,'available') RETURNING id`,
      [orgId, mapId, String(n), ticketTypeId],
    );
    ids.push(Number(row.rows[0].id));
  }
  return ids;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
