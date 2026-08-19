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

const ORG = { slug: 'checkout-e2e', name: 'Checkout E2E' };
const OTHER_ORG = { slug: 'checkout-e2e-other', name: 'Checkout E2E Other' };

const GA = 'chk-ga-summit';
const FREE = 'chk-free-meetup';
const ONLINE = 'chk-online-webinar';
const GALA = 'chk-gala-dinner';
const DRAFT = 'chk-draft-secret';
const STARTED = 'chk-already-started';
const FOREIGN = 'chk-foreign-summit';

const BAHT = 100;
const UNKNOWN_UUID = '00000000-0000-4000-8000-0000000000ff';

interface Success<T> {
  data: T;
}
interface View {
  event: { slug: string; seatingMode: string; venueName: string | null };
  tiers: {
    id: string;
    name: string;
    priceLabel: string;
    canSelect: boolean;
    remaining: number | null;
  }[];
  seatMap: { seats: { id: number; available: boolean }[] } | null;
  notes: { seating: string | null; delivery: string | null };
  maxPerBooking: number;
  paymentRequired: boolean;
}
interface Summary {
  quantity: number;
  seatIds: number[] | null;
  unitPriceSatang: number;
  subtotalSatang: number;
  discountSatang: number;
  serviceFeeSatang: number;
  totalSatang: number;
  netSatang: number;
  vatSatang: number;
  discountCode: string | null;
  labels: { subtotal: string; total: string; discount: string | null };
  paymentRequired: boolean;
}
interface Hold {
  holdIds: number[];
  expiresAt: string;
}

describe('Checkout (e2e — US-DISC-04)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let ids: {
    orgId: number;
    events: Record<string, string>;
    tiers: Record<string, string>;
    seats: number[];
  };

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
    await pool.query(`DELETE FROM seat_holds WHERE organization_id = $1`, [
      ids.orgId,
    ]);
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  /** No Authorization header anywhere — registration requires no account. */
  const open = (slug: string) =>
    request(server).get(`/api/v1/public/checkout/${slug}`);
  const quote = (body: object) =>
    request(server).post('/api/v1/public/checkout/quote').send(body);
  const hold = (body: object) =>
    request(server).post('/api/v1/public/checkout/hold').send(body);
  const release = (body: object) =>
    request(server).delete('/api/v1/public/checkout/hold').send(body);

  const view = async (slug: string): Promise<View> => {
    const res = await open(slug);
    expect(res.status).toBe(200);
    return (res.body as Success<View>).data;
  };

  describe('opening checkout', () => {
    it('opens with no account at all', async () => {
      const v = await view(GA);
      expect(v.event.slug).toBe(GA);
      expect(v.maxPerBooking).toBe(8);
    });

    it('lists the ticket types with prices in Baht', async () => {
      const v = await view(GA);
      const general = v.tiers.find((t) => t.name === 'General');
      expect(general).toMatchObject({
        priceLabel: '฿1,000',
        canSelect: true,
        remaining: 100,
      });
    });

    it('shows a sold-out tier but will not let it be chosen', async () => {
      const vip = (await view(GA)).tiers.find((t) => t.name === 'VIP');
      expect(vip).toMatchObject({ canSelect: false, remaining: 0 });
    });

    it('tells a general-admission buyer seating is first-come', async () => {
      const v = await view(GA);
      expect(v.notes.seating).toMatch(/first[- ]come/i);
      expect(v.seatMap).toBeNull();
    });

    it('promises an online buyer a join link by email', async () => {
      const v = await view(ONLINE);
      expect(v.notes.delivery).toMatch(/join link/i);
      expect(v.event.venueName).toBeNull();
    });

    it('shows every tier as Free and skips payment for a free event', async () => {
      const v = await view(FREE);
      expect(v.tiers.every((t) => t.priceLabel === 'Free')).toBe(true);
      expect(v.paymentRequired).toBe(false);
    });

    it('draws the seat map for a reserved-seating event', async () => {
      const v = await view(GALA);
      expect(v.event.seatingMode).toBe('reserved');
      // All six seats are drawn; the blocked one is greyed out, not missing.
      expect(v.seatMap?.seats).toHaveLength(ids.seats.length + 1);
      expect(v.seatMap?.seats.filter((s) => s.available)).toHaveLength(
        ids.seats.length,
      );
    });

    it('is not available for an event that was never published', async () => {
      expect((await open(DRAFT)).status).toBe(404);
    });

    it('is not available for an event that does not exist', async () => {
      expect((await open('no-such-event')).status).toBe(404);
    });

    it('refuses once the event has already begun', async () => {
      const res = await open(STARTED);
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(/closed/i);
    });
  });

  describe('the live order summary', () => {
    const gaQuote = (body: object = {}) =>
      quote({
        eventId: ids.events[GA],
        ticketTypeId: ids.tiers.general,
        quantity: 2,
        ...body,
      });

    it('adds subtotal, service fee and VAT into one total', async () => {
      const res = await gaQuote();
      expect(res.status).toBe(200);
      const s = (res.body as Success<Summary>).data;
      expect(s.subtotalSatang).toBe(2_000 * BAHT);
      expect(s.serviceFeeSatang).toBe(100 * BAHT); // 5%
      expect(s.totalSatang).toBe(2_100 * BAHT);
      expect(s.netSatang + s.vatSatang).toBe(s.totalSatang);
      expect(s.labels.total).toBe('฿2,100');
      expect(s.paymentRequired).toBe(true);
    });

    it('rejects a request that tries to smuggle in its own price', async () => {
      // The DTO carries no money field at all, so these are not ignored — they
      // are refused. A client can say what it wants, never what it costs.
      const res = await gaQuote({
        unitPriceSatang: 1,
        totalSatang: 1,
        subtotalSatang: 1,
      });
      expect(res.status).toBe(400);
    });

    it('re-reads the price at the moment it quotes', async () => {
      await pool.query(
        `UPDATE ticket_types SET price_satang = $1 WHERE id = $2`,
        [1_500 * BAHT, ids.tiers.general],
      );
      const s = (await gaQuote()).body as Success<Summary>;
      expect(s.data.unitPriceSatang).toBe(1_500 * BAHT);
      expect(s.data.subtotalSatang).toBe(3_000 * BAHT);
      await pool.query(
        `UPDATE ticket_types SET price_satang = $1 WHERE id = $2`,
        [1_000 * BAHT, ids.tiers.general],
      );
    });

    it('applies a discount code and charges the fee on what is left', async () => {
      const res = await gaQuote({ discountCode: 'chk25' });
      const s = (res.body as Success<Summary>).data;
      expect(s.discountSatang).toBe(500 * BAHT); // 25% of ฿2,000
      expect(s.serviceFeeSatang).toBe(75 * BAHT); // 5% of ฿1,500
      expect(s.totalSatang).toBe(1_575 * BAHT);
      expect(s.discountCode).toBe('CHK25');
      expect(s.labels.discount).toBe('฿500');
    });

    it('tells the buyer plainly when a code is not recognised', async () => {
      const res = await gaQuote({ discountCode: 'nope404' });
      expect(res.status).toBe(422);
    });

    it('charges nothing for a free tier and skips payment', async () => {
      const res = await quote({
        eventId: ids.events[FREE],
        ticketTypeId: ids.tiers.free,
        quantity: 3,
      });
      const s = (res.body as Success<Summary>).data;
      expect(s.subtotalSatang).toBe(0);
      expect(s.serviceFeeSatang).toBe(0);
      expect(s.totalSatang).toBe(0);
      expect(s.paymentRequired).toBe(false);
    });

    it('refuses more than 8 tickets in one booking', async () => {
      expect((await gaQuote({ quantity: 9 })).status).toBe(400);
    });

    it('refuses a quantity of zero', async () => {
      expect((await gaQuote({ quantity: 0 })).status).toBe(400);
    });

    it('refuses a ticket type that belongs to another event', async () => {
      const res = await gaQuote({ ticketTypeId: ids.tiers.foreign });
      expect(res.status).toBe(404);
    });

    it('refuses a ticket type that does not exist', async () => {
      expect((await gaQuote({ ticketTypeId: UNKNOWN_UUID })).status).toBe(404);
    });

    it('refuses an event that does not exist', async () => {
      expect((await gaQuote({ eventId: UNKNOWN_UUID })).status).toBe(404);
    });

    describe('reserved seating', () => {
      const galaQuote = (body: object = {}) =>
        quote({
          eventId: ids.events[GALA],
          ticketTypeId: ids.tiers.gala,
          ...body,
        });

      it('prices one ticket per chosen seat', async () => {
        const res = await galaQuote({ seatIds: ids.seats.slice(0, 2) });
        const s = (res.body as Success<Summary>).data;
        expect(s.quantity).toBe(2);
        expect(s.seatIds).toEqual(ids.seats.slice(0, 2));
        expect(s.subtotalSatang).toBe(4_000 * BAHT); // ฿2,000 each
      });

      it('asks a reserved-seating buyer for seats, not a number', async () => {
        const res = await galaQuote({ quantity: 2 });
        expect(res.status).toBe(422);
        expect((res.body as { message: string }).message).toMatch(/seat/i);
      });

      it('refuses a seat that is not on this map', async () => {
        expect((await galaQuote({ seatIds: [999_999] })).status).toBe(409);
      });

      it('refuses the same seat picked twice', async () => {
        const seat = ids.seats[0];
        const res = await galaQuote({ seatIds: [seat, seat] });
        expect(res.status).toBe(422);
        expect((res.body as { message: string }).message).toMatch(/twice/i);
      });
    });

    it('refuses seats on a general-admission event', async () => {
      const res = await gaQuote({ quantity: undefined, seatIds: [1] });
      expect(res.status).toBe(422);
      expect((res.body as { message: string }).message).toMatch(
        /general admission/i,
      );
    });
  });

  describe('holding inventory while the buyer pays', () => {
    it('holds a general-admission quantity and says when it lapses', async () => {
      const res = await hold({
        eventId: ids.events[GA],
        ticketTypeId: ids.tiers.general,
        quantity: 2,
      });
      expect(res.status).toBe(201);
      const h = (res.body as Success<Hold>).data;
      expect(h.holdIds).toHaveLength(1);
      expect(Date.parse(h.expiresAt)).toBeGreaterThan(Date.now());
    });

    it('refuses to oversell a tier', async () => {
      // 'Scarce' has 2 left; hold them, then try for one more.
      const first = await hold({
        eventId: ids.events[GA],
        ticketTypeId: ids.tiers.scarce,
        quantity: 2,
      });
      expect(first.status).toBe(201);
      const second = await hold({
        eventId: ids.events[GA],
        ticketTypeId: ids.tiers.scarce,
        quantity: 1,
      });
      expect(second.status).toBe(409);
      expect((second.body as { message: string }).message).toMatch(/left/i);
    });

    it('holds the named seats, one hold each', async () => {
      const res = await hold({
        eventId: ids.events[GALA],
        ticketTypeId: ids.tiers.gala,
        seatIds: ids.seats.slice(0, 2),
      });
      expect(res.status).toBe(201);
      expect((res.body as Success<Hold>).data.holdIds).toHaveLength(2);
    });

    it('will not hand the same seat to two buyers', async () => {
      const seatIds = ids.seats.slice(0, 1);
      const body = {
        eventId: ids.events[GALA],
        ticketTypeId: ids.tiers.gala,
        seatIds,
      };
      expect((await hold(body)).status).toBe(201);
      const second = await hold(body);
      expect(second.status).toBe(409);
      expect((second.body as { message: string }).message).toMatch(
        /just taken/i,
      );
    });

    it('shows a held seat as unavailable on the map', async () => {
      const seatId = ids.seats[0];
      await hold({
        eventId: ids.events[GALA],
        ticketTypeId: ids.tiers.gala,
        seatIds: [seatId],
      });
      const v = await view(GALA);
      expect(v.seatMap?.seats.find((s) => s.id === seatId)?.available).toBe(
        false,
      );
    });

    it('gives the seat back when the buyer walks away', async () => {
      const seatIds = ids.seats.slice(0, 1);
      const body = {
        eventId: ids.events[GALA],
        ticketTypeId: ids.tiers.gala,
        seatIds,
      };
      const first = (await hold(body)).body as Success<Hold>;
      const released = await release({
        eventId: ids.events[GALA],
        holdIds: first.data.holdIds,
      });
      expect(released.status).toBe(204);
      // Free again for the next person.
      expect((await hold(body)).status).toBe(201);
    });

    it('refuses to hold a sold-out tier', async () => {
      const res = await hold({
        eventId: ids.events[GA],
        ticketTypeId: ids.tiers.vip,
        quantity: 1,
      });
      expect(res.status).toBe(409);
    });
  });
});

async function seed(pool: Pool): Promise<{
  orgId: number;
  events: Record<string, string>;
  tiers: Record<string, string>;
  seats: number[];
}> {
  const orgId = await insertOrg(pool, ORG);
  const otherOrgId = await insertOrg(pool, OTHER_ORG);
  const events: Record<string, string> = {};
  const tiers: Record<string, string> = {};

  events[GA] = await insertEvent(pool, orgId, { slug: GA, name: 'GA Summit' });
  tiers.general = await insertTier(pool, orgId, events[GA], {
    name: 'General',
    price: 1_000 * BAHT,
    total: 100,
  });
  tiers.vip = await insertTier(pool, orgId, events[GA], {
    name: 'VIP',
    price: 3_000 * BAHT,
    total: 2,
    sold: 2,
  });
  tiers.scarce = await insertTier(pool, orgId, events[GA], {
    name: 'Scarce',
    price: 500 * BAHT,
    total: 2,
  });

  events[FREE] = await insertEvent(pool, orgId, {
    slug: FREE,
    name: 'Free Meetup',
  });
  tiers.free = await insertTier(pool, orgId, events[FREE], {
    name: 'RSVP',
    price: 0,
    total: 50,
    isFree: true,
  });

  events[ONLINE] = await insertEvent(pool, orgId, {
    slug: ONLINE,
    name: 'Online Webinar',
    isOnline: true,
  });
  tiers.online = await insertTier(pool, orgId, events[ONLINE], {
    name: 'Seat',
    price: 200 * BAHT,
    total: 500,
  });

  events[GALA] = await insertEvent(pool, orgId, {
    slug: GALA,
    name: 'Gala Dinner',
    seatingMode: 'reserved',
  });
  tiers.gala = await insertTier(pool, orgId, events[GALA], {
    name: 'Table',
    price: 2_000 * BAHT,
    total: 20,
  });
  const seats = await insertSeatMap(pool, orgId, events[GALA], tiers.gala);

  events[DRAFT] = await insertEvent(pool, orgId, {
    slug: DRAFT,
    name: 'Draft Secret',
    status: 'draft',
    visibility: 'private',
    published: false,
  });
  events[STARTED] = await insertEvent(pool, orgId, {
    slug: STARTED,
    name: 'Already Started',
    startsInDays: -1,
  });

  // A ticket type on another workspace's event — must never price this order.
  events[FOREIGN] = await insertEvent(pool, otherOrgId, {
    slug: FOREIGN,
    name: 'Foreign Summit',
  });
  tiers.foreign = await insertTier(pool, otherOrgId, events[FOREIGN], {
    name: 'General',
    price: 1 * BAHT,
    total: 100,
  });

  await pool.query(
    `INSERT INTO discount_codes (organization_id, event_id, code, type, value, status)
     VALUES ($1,$2,'CHK25','percent',25,'active')`,
    [orgId, events[GA]],
  );
  return { orgId, events, tiers, seats };
}

async function insertOrg(
  pool: Pool,
  org: { slug: string; name: string },
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, vat_rate, service_fee_rate)
     VALUES ($1,$2,0.0700,0.0500) RETURNING id`,
    [org.name, org.slug],
  );
  return Number(res.rows[0].id);
}

interface EventSeed {
  slug: string;
  name: string;
  startsInDays?: number;
  isOnline?: boolean;
  seatingMode?: string;
  status?: string;
  visibility?: string;
  published?: boolean;
}

async function insertEvent(
  pool: Pool,
  orgId: number,
  e: EventSeed,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, venue_name, city,
                         is_online, seating_mode, published_at)
     VALUES ($1,$2,$3,'Conference','active',$4,$5,
             now() + ($6 || ' days')::interval,'Asia/Bangkok','Acme Events',
             'QSNCC','Bangkok',$7,$8,
             CASE WHEN $9 THEN now() ELSE NULL END)
     RETURNING id`,
    [
      orgId,
      e.slug,
      e.name,
      e.status ?? 'upcoming',
      e.visibility ?? 'public',
      String(e.startsInDays ?? 30),
      e.isOnline ?? false,
      e.seatingMode ?? 'ga',
      e.published ?? true,
    ],
  );
  return res.rows[0].id;
}

async function insertTier(
  pool: Pool,
  orgId: number,
  eventId: string,
  t: {
    name: string;
    price: number;
    total: number;
    sold?: number;
    isFree?: boolean;
  },
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang, is_free,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,$3,$4,$5,'onsale',$6,$7,1,8) RETURNING id`,
    [orgId, eventId, t.name, t.price, t.isFree ?? false, t.total, t.sold ?? 0],
  );
  return res.rows[0].id;
}

/** Six seats bound to the tier, one of them blocked so the map has both states. */
async function insertSeatMap(
  pool: Pool,
  orgId: number,
  eventId: string,
  ticketTypeId: string,
): Promise<number[]> {
  const map = await pool.query<{ id: string }>(
    `INSERT INTO seat_maps (organization_id, event_id, name, total_seats)
     VALUES ($1,$2,'Main',6) RETURNING id`,
    [orgId, eventId],
  );
  const mapId = Number(map.rows[0].id);
  const available: number[] = [];
  for (let n = 1; n <= 6; n += 1) {
    const status = n === 6 ? 'blocked' : 'available';
    const row = await pool.query<{ id: string }>(
      `INSERT INTO seats (organization_id, seat_map_id, section, row_label,
                          seat_number, ticket_type_id, status)
       VALUES ($1,$2,'Stalls','A',$3,$4,$5) RETURNING id`,
      [orgId, mapId, String(n), ticketTypeId, status],
    );
    if (status === 'available') available.push(Number(row.rows[0].id));
  }
  return available;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [
    [ORG.slug, OTHER_ORG.slug],
  ]);
}
