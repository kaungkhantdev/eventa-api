process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';
import { listenOnLoopback } from './support/loopback';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'seat-e2e', name: 'Seating E2E' };
const ORG2 = { slug: 'seat-e2e-2', name: 'Seating E2E 2' };
const ADMIN = 'admin@seat-e2e.test';
const LIMITED = 'staff@seat-e2e.test';
const ADMIN2 = 'admin@seat-e2e-2.test';

interface Success<T> {
  data: T;
}
interface Seating {
  seatingMode: string;
  isOnline: boolean;
  capacity: number | null;
  seatMap: {
    name: string;
    rows: number;
    seatsPerRow: number;
    totalSeats: number;
  } | null;
  rows: {
    rowLabel: string;
    ticketTypeId: string | null;
    seats: number;
    seatTicketTypes: (string | null)[];
  }[];
  unassignedRows: number;
  unassignedSeats: number;
  ticketQuantity: number;
  seatShortfall: { totalSeats: number; ticketQuantity: number } | null;
  note: string | null;
}
interface Failure {
  message: string;
}
interface Ticket {
  id: string;
  name: string;
  total: number;
  status: string;
}

describe('Seating (e2e — US-EVT-05)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;
  let foreignEventId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['evCreate'] },
      { email: LIMITED, roleName: 'Organizer', grants: ['regView'] },
    ]);
    await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['evCreate'] },
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, ORG.slug);
    foreignEventId = await createEvent(await token(ADMIN2, ORG2.slug), 'Other');
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const token = async (email: string, orgSlug: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  };

  async function createEvent(jwt: string, name: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name, type: 'Conference', startAt: '2026-09-01T02:00:00Z' });
    return (res.body as Success<{ id: string }>).data.id;
  }

  const reserved = (id: string, jwt: string, body: Record<string, unknown>) =>
    request(server)
      .put(`/api/v1/events/${id}/seating/reserved`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const getSeating = (id: string, jwt: string) =>
    request(server)
      .get(`/api/v1/events/${id}/seating`)
      .set('Authorization', `Bearer ${jwt}`);

  it('sets a general-admission headcount (no seat map)', async () => {
    const id = await createEvent(adminJwt, 'GA Event');
    const res = await request(server)
      .put(`/api/v1/events/${id}/seating/general`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ headcount: 250 });
    expect(res.status).toBe(200);
    const s = (res.body as Success<Seating>).data;
    expect(s).toMatchObject({
      seatingMode: 'ga',
      capacity: 250,
      seatMap: null,
    });
  });

  it('lays out reserved seating with rows × seats and a total count', async () => {
    const id = await createEvent(adminJwt, 'Reserved Event');
    const res = await reserved(id, adminJwt, {
      name: 'Grand Hall',
      rows: 4,
      seatsPerRow: 5,
    });
    expect(res.status).toBe(200);
    const s = (res.body as Success<Seating>).data;
    expect(s.seatingMode).toBe('reserved');
    expect(s.seatMap).toMatchObject({
      rows: 4,
      seatsPerRow: 5,
      totalSeats: 20,
    });

    // The 20 seats were actually generated.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM seats se
         JOIN seat_maps m ON m.id = se.seat_map_id WHERE m.event_id = $1`,
      [id],
    );
    expect(Number(rows[0].n)).toBe(20);
  });

  it('reconfiguring the same layout is idempotent (no duplicate seats)', async () => {
    const id = await createEvent(adminJwt, 'Idempotent Event');
    const seatCount = async (): Promise<number> => {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM seats se
           JOIN seat_maps m ON m.id = se.seat_map_id WHERE m.event_id = $1`,
        [id],
      );
      return Number(rows[0].n);
    };
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 2,
    }).expect(200);
    expect(await seatCount()).toBe(4);
    // Re-applying the identical layout must not duplicate the 4 seats.
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 2,
    }).expect(200);
    expect(await seatCount()).toBe(4);
  });

  it('warns when the seat map is smaller than ticket quantities', async () => {
    const id = await createEvent(adminJwt, 'Shortfall Event');
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 3,
    }).expect(200); // 6 seats
    await request(server)
      .post(`/api/v1/events/${id}/tickets`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ name: 'GA', priceSatang: 10000, total: 50 })
      .expect(201);

    const res = await getSeating(id, adminJwt);
    expect((res.body as Success<Seating>).data.seatShortfall).toEqual({
      totalSeats: 6,
      ticketQuantity: 50,
    });
  });

  it('offers no seating for an online event', async () => {
    const id = await createEvent(adminJwt, 'Online Event');
    await request(server)
      .patch(`/api/v1/events/${id}`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ isOnline: true })
      .expect(200);

    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 2,
    }).expect(422);
    const res = await getSeating(id, adminJwt);
    const s = (res.body as Success<Seating>).data;
    expect(s.isOnline).toBe(true);
    expect(s.seatMap).toBeNull();
    expect(s.note).toMatch(/join link/i);
  });

  it('never removes an already-sold seat when shrinking a published event (422)', async () => {
    const id = await createEvent(adminJwt, 'Published Reserved');
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 3,
      seatsPerRow: 3,
    }).expect(200); // 9 seats

    // Simulate publication + a sold seat in the last row (position row 3, seat 1).
    await pool.query(`UPDATE events SET status = 'upcoming' WHERE id = $1`, [
      id,
    ]);
    await pool.query(
      `UPDATE seats SET status = 'sold'
         WHERE seat_map_id = (SELECT id FROM seat_maps WHERE event_id = $1)
           AND row_label = '3' AND seat_number = '1'`,
      [id],
    );

    // Shrinking to 2 rows would drop the sold seat — blocked.
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 3,
    }).expect(422);
    // Shrinking columns only (still keeps row 3 seat 1) is allowed.
    await reserved(id, adminJwt, {
      name: 'Hall',
      rows: 3,
      seatsPerRow: 2,
    }).expect(200);
  });

  describe('seats split between ticket types (US-EVT-05)', () => {
    const FUTURE = '2027-03-01T02:00:00Z';
    let eventId: string;
    let tiers: Record<'vip' | 'normal' | 'free', string>;

    const auth = () => ({ Authorization: `Bearer ${adminJwt}` });

    async function addTicket(
      id: string,
      body: Record<string, unknown>,
    ): Promise<string> {
      const res = await request(server)
        .post(`/api/v1/events/${id}/tickets`)
        .set(auth())
        .send(body)
        .expect(201);
      return (res.body as Success<{ id: string }>).data.id;
    }

    async function totals(id: string): Promise<Record<string, number>> {
      const res = await request(server)
        .get(`/api/v1/events/${id}/tickets`)
        .set(auth())
        .expect(200);
      const list = (res.body as Success<Ticket[]>).data;
      return Object.fromEntries(list.map((t) => [t.name, t.total]));
    }

    async function seatTypesByRow(id: string): Promise<Record<string, string>> {
      const { rows } = await pool.query<{ row_label: string; types: string }>(
        `SELECT se.row_label,
                string_agg(DISTINCT coalesce(se.ticket_type_id::text, 'none'), ',') AS types
           FROM seats se JOIN seat_maps m ON m.id = se.seat_map_id
          WHERE m.event_id = $1 GROUP BY se.row_label`,
        [id],
      );
      return Object.fromEntries(rows.map((r) => [r.row_label, r.types]));
    }

    /** Rows 1–2 VIP, 3–6 Normal, 7 Free — the user's own example. */
    const example = () => [
      tiers.vip,
      tiers.vip,
      tiers.normal,
      tiers.normal,
      tiers.normal,
      tiers.normal,
      tiers.free,
    ];

    beforeAll(async () => {
      const res = await request(server)
        .post('/api/v1/events')
        .set(auth())
        .send({ name: 'Rows Gala', type: 'Conference', startAt: FUTURE });
      eventId = (res.body as Success<{ id: string }>).data.id;
      tiers = {
        vip: await addTicket(eventId, {
          name: 'VIP',
          priceSatang: 250000,
          total: 100,
        }),
        normal: await addTicket(eventId, {
          name: 'Normal',
          priceSatang: 89000,
          total: 100,
        }),
        free: await addTicket(eventId, {
          name: 'Free',
          isFree: true,
          total: 100,
        }),
      };
    });

    it('gives whole rows a ticket type (rowTicketTypes) and makes each quantity its seats', async () => {
      const res = await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 7,
        seatsPerRow: 16,
        rowTicketTypes: example(),
      });
      expect(res.status).toBe(200);
      const s = (res.body as Success<Seating>).data;
      expect(s.rows).toHaveLength(7);
      expect(s.rows[0]).toEqual({
        rowLabel: '1',
        ticketTypeId: tiers.vip,
        seats: 16,
        seatTicketTypes: Array<string>(16).fill(tiers.vip),
      });
      expect(s.rows[6]).toEqual({
        rowLabel: '7',
        ticketTypeId: tiers.free,
        seats: 16,
        seatTicketTypes: Array<string>(16).fill(tiers.free),
      });
      expect(s.unassignedRows).toBe(0);
      expect(s.unassignedSeats).toBe(0);
      expect(await seatTypesByRow(eventId)).toMatchObject({
        '1': tiers.vip,
        '3': tiers.normal,
        '7': tiers.free,
      });
      expect(await totals(eventId)).toEqual({ VIP: 32, Normal: 64, Free: 16 });
    });

    it('moves a row to another type and both quantities follow', async () => {
      const rowTicketTypes = example();
      rowTicketTypes[5] = tiers.vip;
      await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 7,
        seatsPerRow: 16,
        rowTicketTypes,
      }).expect(200);
      expect(await totals(eventId)).toEqual({ VIP: 48, Normal: 48, Free: 16 });
    });

    it('reads every row and its type back in row order', async () => {
      const res = await getSeating(eventId, adminJwt).expect(200);
      const s = (res.body as Success<Seating>).data;
      expect(s.rows.map((r) => r.rowLabel)).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
      ]);
      expect(s.rows[5].ticketTypeId).toBe(tiers.vip);
    });

    it("keeps each seat's type when no list is sent; a new row gets none", async () => {
      const res = await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 8,
        seatsPerRow: 16,
      }).expect(200);
      const s = (res.body as Success<Seating>).data;
      expect(s.rows[5].ticketTypeId).toBe(tiers.vip);
      expect(s.rows[7]).toEqual({
        rowLabel: '8',
        ticketTypeId: null,
        seats: 16,
        seatTicketTypes: Array<null>(16).fill(null),
      });
      expect(s.unassignedRows).toBe(1);
      expect(s.unassignedSeats).toBe(16);
      expect(await totals(eventId)).toEqual({ VIP: 48, Normal: 48, Free: 16 });
    });

    it("refuses a ticket type that isn't this event's (422), naming the row", async () => {
      const otherEvent = await createEvent(adminJwt, 'Other Gala');
      const stranger = await addTicket(otherEvent, {
        name: 'Elsewhere',
        priceSatang: 10000,
        total: 10,
      });
      const rowTicketTypes = [...example(), null];
      rowTicketTypes[1] = stranger;
      const res = await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 8,
        seatsPerRow: 16,
        rowTicketTypes,
      });
      expect(res.status).toBe(422);
      expect((res.body as Failure).message).toBe(
        "Row 2's ticket type isn't one of this event's ticket types.",
      );
    });

    it('refuses an entry that is no ticket type at all (422), naming the row', async () => {
      const rowTicketTypes = [...example(), 'not-a-ticket-type'];
      const res = await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 8,
        seatsPerRow: 16,
        rowTicketTypes,
      });
      expect(res.status).toBe(422);
      expect((res.body as Failure).message).toBe(
        "Row 8's ticket type isn't one of this event's ticket types.",
      );
    });

    it('refuses a list that is not one entry per row (422)', async () => {
      await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 8,
        seatsPerRow: 16,
        rowTicketTypes: example(),
      }).expect(422);
    });

    it('refuses rows that would hold fewer seats than a type sold (409)', async () => {
      await pool.query(`UPDATE ticket_types SET sold = 40 WHERE id = $1`, [
        tiers.normal,
      ]);
      const rowTicketTypes = [...example(), null];
      rowTicketTypes[2] = tiers.vip;
      rowTicketTypes[3] = tiers.vip;
      const res = await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 8,
        seatsPerRow: 16,
        rowTicketTypes,
      });
      await pool.query(`UPDATE ticket_types SET sold = 0 WHERE id = $1`, [
        tiers.normal,
      ]);
      expect(res.status).toBe(409);
      expect((res.body as Failure).message).toBe(
        'Normal has sold 40 tickets, more than the 32 seats it now holds.',
      );
      // Nothing was written: row 3 still sells Normal.
      expect((await seatTypesByRow(eventId))['3']).toBe(tiers.normal);
    });

    it("refuses to change a held seat's type (409); an expired hold doesn't count", async () => {
      const { rows } = await pool.query<{ id: string; org: string }>(
        `SELECT se.id, se.organization_id AS org FROM seats se
           JOIN seat_maps m ON m.id = se.seat_map_id
          WHERE m.event_id = $1 AND se.row_label = '4' AND se.seat_number = '8'`,
        [eventId],
      );
      const insertHold = (expires: string) =>
        pool.query(
          `INSERT INTO seat_holds (organization_id, event_id, seat_id, quantity, status, expires_at)
           VALUES ($1, $2, $3, 1, 'active', now() + $4::interval)`,
          [rows[0].org, eventId, rows[0].id, expires],
        );
      const rowTicketTypes = [...example(), null];
      rowTicketTypes[3] = tiers.vip;
      const body = { name: 'Hall', rows: 8, seatsPerRow: 16, rowTicketTypes };

      await insertHold('10 minutes');
      const res = await reserved(eventId, adminJwt, body);
      expect(res.status).toBe(409);
      expect((res.body as Failure).message).toBe(
        "Row 4 seat 8 is booked or held, so its ticket type can't change.",
      );
      expect((await seatTypesByRow(eventId))['4']).toBe(tiers.normal);

      await pool.query(`DELETE FROM seat_holds WHERE event_id = $1`, [eventId]);
      await insertHold('-1 minute');
      await reserved(eventId, adminJwt, body).expect(200);
      expect((await seatTypesByRow(eventId))['4']).toBe(tiers.vip);
      await pool.query(`DELETE FROM seat_holds WHERE event_id = $1`, [eventId]);
    });

    it("refuses to change a booked seat's type (409)", async () => {
      await request(server)
        .patch(`/api/v1/events/${eventId}`)
        .set(auth())
        .send({ description: 'A gala', venueName: 'Grand Hall' })
        .expect(200);
      await pool.query(
        `UPDATE events SET status = 'upcoming', visibility = 'public', published_at = now()
          WHERE id = $1`,
        [eventId],
      );
      const { rows } = await pool.query<{ id: string }>(
        `SELECT se.id FROM seats se JOIN seat_maps m ON m.id = se.seat_map_id
          WHERE m.event_id = $1 AND se.row_label = '7' AND se.seat_number = '1'`,
        [eventId],
      );
      const seatIds = [Number(rows[0].id)];
      const held = await request(server)
        .post('/api/v1/public/checkout/hold')
        .send({ eventId, ticketTypeId: tiers.free, seatIds })
        .expect(201);
      const holdIds = (held.body as Success<{ holdIds: number[] }>).data
        .holdIds;
      await request(server)
        .post('/api/v1/public/checkout/confirm')
        .send({
          eventId,
          ticketTypeId: tiers.free,
          seatIds,
          holdIds,
          buyer: { name: 'Anong P.', email: 'anong.p@example.test' },
          idempotencyKey: 'seat-rows-booked-1',
        })
        .expect(201);

      // Published now, so every row is sent with a type.
      const rowTicketTypes = [...example(), tiers.normal];
      rowTicketTypes[6] = tiers.normal;
      const res = await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 8,
        seatsPerRow: 16,
        rowTicketTypes,
      });
      expect(res.status).toBe(409);
      expect((res.body as Failure).message).toBe(
        "Row 7 seat 1 is booked or held, so its ticket type can't change.",
      );
      expect((await seatTypesByRow(eventId))['7']).toBe(tiers.free);
    });

    it('refuses a published event a seat with no ticket type (422); every new row needs one', async () => {
      // Published by the test above; its row 8 was added untyped as a draft.
      const res = await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 9,
        seatsPerRow: 16,
        rowTicketTypes: [...example(), tiers.normal, null],
      });
      expect(res.status).toBe(422);
      expect((res.body as Failure).message).toBe(
        'Give every seat in row 9 a ticket type. Every seat of a published event needs one.',
      );
      const kept = await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 9,
        seatsPerRow: 16,
      });
      expect(kept.status).toBe(422);
      expect((kept.body as Failure).message).toMatch(
        /^Give every seat in row 8 /,
      );
      expect(Object.keys(await seatTypesByRow(eventId))).toHaveLength(8);

      const typed = await reserved(eventId, adminJwt, {
        name: 'Hall',
        rows: 9,
        seatsPerRow: 16,
        rowTicketTypes: [...example(), tiers.normal, tiers.vip],
      });
      expect(typed.status).toBe(200);
      expect((typed.body as Success<Seating>).data.unassignedRows).toBe(0);
    });

    it('leaves a map laid out without ticket types on its typed quantities', async () => {
      const legacy = await createEvent(adminJwt, 'Legacy Hall');
      await addTicket(legacy, { name: 'Any', priceSatang: 10000, total: 50 });
      const res = await reserved(legacy, adminJwt, {
        name: 'Hall',
        rows: 2,
        seatsPerRow: 3,
      }).expect(200);
      const s = (res.body as Success<Seating>).data;
      expect(s.rows.every((r) => r.ticketTypeId === null)).toBe(true);
      expect(s.unassignedRows).toBe(2);
      expect(await totals(legacy)).toEqual({ Any: 50 });
    });

    describe('seat by seat (seatTicketTypes)', () => {
      let gala: string;
      let t: Record<'vip' | 'normal' | 'free', string>;

      const seatsOf = (n: number, type: string | null) =>
        Array<string | null>(n).fill(type);

      /**
       * Rows 1–2 VIP, rows 3–6 Normal, and row 7 split: seats 1–5 Free, seats
       * 6–16 Normal — the user's own example of a few free seats in a row.
       */
      const split = (): (string | null)[][] => [
        seatsOf(16, t.vip),
        seatsOf(16, t.vip),
        seatsOf(16, t.normal),
        seatsOf(16, t.normal),
        seatsOf(16, t.normal),
        seatsOf(16, t.normal),
        [...seatsOf(5, t.free), ...seatsOf(11, t.normal)],
      ];

      const layout = (o: Record<string, unknown>) =>
        reserved(gala, adminJwt, {
          name: 'Hall',
          rows: 7,
          seatsPerRow: 16,
          ...o,
        });

      /** One row's seats and their types, in seat-number order. */
      async function rowTypes(row: string): Promise<(string | null)[]> {
        const { rows } = await pool.query<{ type: string | null }>(
          `SELECT se.ticket_type_id AS type
             FROM seats se JOIN seat_maps m ON m.id = se.seat_map_id
            WHERE m.event_id = $1 AND se.row_label = $2
            ORDER BY se.seat_number::int`,
          [gala, row],
        );
        return rows.map((r) => r.type);
      }

      beforeAll(async () => {
        gala = await createEvent(adminJwt, 'Seats Gala');
        t = {
          vip: await addTicket(gala, {
            name: 'VIP',
            priceSatang: 250000,
            total: 100,
          }),
          normal: await addTicket(gala, {
            name: 'Normal',
            priceSatang: 89000,
            total: 100,
          }),
          free: await addTicket(gala, {
            name: 'Free',
            isFree: true,
            total: 100,
          }),
        };
      });

      it('gives just the seats sent a type, part of a row included, and makes each quantity its seats', async () => {
        const res = await layout({ seatTicketTypes: split() });
        expect(res.status).toBe(200);
        const s = (res.body as Success<Seating>).data;
        expect(s.rows[0]).toMatchObject({
          rowLabel: '1',
          ticketTypeId: t.vip,
        });
        expect(s.rows[6]).toEqual({
          rowLabel: '7',
          ticketTypeId: null,
          seats: 16,
          seatTicketTypes: split()[6],
        });
        expect(s.unassignedRows).toBe(0);
        expect(s.unassignedSeats).toBe(0);
        expect(await rowTypes('7')).toEqual(split()[6]);
        expect(await totals(gala)).toEqual({ VIP: 32, Normal: 75, Free: 5 });
      });

      it("reads each seat's type back, rows and seats in number order", async () => {
        const res = await getSeating(gala, adminJwt).expect(200);
        const s = (res.body as Success<Seating>).data;
        expect(s.rows.map((r) => r.seatTicketTypes)).toEqual(split());
        expect(s.rows.map((r) => r.ticketTypeId)).toEqual([
          t.vip,
          t.vip,
          t.normal,
          t.normal,
          t.normal,
          t.normal,
          null,
        ]);
      });

      it("keeps every seat's type when no list is sent; a new seat gets none", async () => {
        const res = await layout({ seatsPerRow: 17 }).expect(200);
        const s = (res.body as Success<Seating>).data;
        expect(s.rows[6].seatTicketTypes).toEqual([...split()[6], null]);
        expect(s.unassignedRows).toBe(7);
        expect(s.unassignedSeats).toBe(7);
        expect(await totals(gala)).toEqual({ VIP: 32, Normal: 75, Free: 5 });

        await layout({}).expect(200);
        expect(await rowTypes('7')).toEqual(split()[6]);
      });

      it('refuses rowTicketTypes and seatTicketTypes together (422)', async () => {
        const res = await layout({
          rowTicketTypes: split().map((r) => r[0]),
          seatTicketTypes: split(),
        });
        expect(res.status).toBe(422);
        expect((res.body as Failure).message).toBe(
          'Send rowTicketTypes or seatTicketTypes, not both.',
        );
      });

      it('refuses a list that is not one row per row of the map (422)', async () => {
        const res = await layout({ seatTicketTypes: split().slice(0, 6) });
        expect(res.status).toBe(422);
        expect((res.body as Failure).message).toBe(
          'Send one ticket type per row: this map has 7 rows, but 6 were sent.',
        );
      });

      it('refuses a row that is not one entry per seat (422, row named)', async () => {
        const sent = split();
        sent[2] = sent[2].slice(0, 15);
        const res = await layout({ seatTicketTypes: sent });
        expect(res.status).toBe(422);
        expect((res.body as Failure).message).toBe(
          'Send one ticket type per seat: row 3 has 16 seats, but 15 were sent.',
        );
      });

      it("refuses a seat whose type isn't this event's (422, row and seat named), writing nothing", async () => {
        const elsewhere = await createEvent(adminJwt, 'Elsewhere Gala');
        const stranger = await addTicket(elsewhere, {
          name: 'Elsewhere',
          priceSatang: 10000,
          total: 10,
        });
        const sent = split();
        sent[1][3] = stranger;
        sent[6][0] = t.normal;
        const res = await layout({ seatTicketTypes: sent });
        expect(res.status).toBe(422);
        expect((res.body as Failure).message).toBe(
          "Row 2 seat 4's ticket type isn't one of this event's ticket types.",
        );
        expect(await rowTypes('7')).toEqual(split()[6]);
      });

      it('lets a draft leave some seats of a row with no type', async () => {
        const sent = split();
        sent[6][15] = null;
        const res = await layout({ seatTicketTypes: sent }).expect(200);
        const s = (res.body as Success<Seating>).data;
        expect(s.unassignedRows).toBe(1);
        expect(s.unassignedSeats).toBe(1);
        expect(s.rows[6].seatTicketTypes[15]).toBeNull();
        expect(await totals(gala)).toEqual({ VIP: 32, Normal: 74, Free: 5 });

        await layout({ seatTicketTypes: split() }).expect(200);
      });

      it("refuses to change a held seat's type (409), yet moves the rest of its row", async () => {
        const { rows } = await pool.query<{ id: string; org: string }>(
          `SELECT se.id, se.organization_id AS org FROM seats se
             JOIN seat_maps m ON m.id = se.seat_map_id
            WHERE m.event_id = $1 AND se.row_label = '7' AND se.seat_number = '3'`,
          [gala],
        );
        await pool.query(
          `INSERT INTO seat_holds (organization_id, event_id, seat_id, quantity, status, expires_at)
           VALUES ($1, $2, $3, 1, 'active', now() + interval '10 minutes')`,
          [rows[0].org, gala, rows[0].id],
        );

        const retyped = split();
        retyped[6][2] = t.normal;
        const res = await layout({ seatTicketTypes: retyped });
        expect(res.status).toBe(409);
        expect((res.body as Failure).message).toBe(
          "Row 7 seat 3 is booked or held, so its ticket type can't change.",
        );
        expect(await rowTypes('7')).toEqual(split()[6]);

        // Seats 4–5 move to Normal; the held seat 3 stays Free.
        const around = split();
        around[6][3] = t.normal;
        around[6][4] = t.normal;
        await layout({ seatTicketTypes: around }).expect(200);
        expect(await rowTypes('7')).toEqual([
          ...seatsOf(3, t.free),
          ...seatsOf(13, t.normal),
        ]);
        expect(await totals(gala)).toEqual({ VIP: 32, Normal: 77, Free: 3 });
        await pool.query(`DELETE FROM seat_holds WHERE event_id = $1`, [gala]);
      });

      it('refuses a published event a seat with no type (422, its row named)', async () => {
        await pool.query(
          `UPDATE events SET status = 'upcoming', visibility = 'public', published_at = now()
            WHERE id = $1`,
          [gala],
        );
        const sent = split();
        sent[2][7] = null;
        const res = await layout({ seatTicketTypes: sent });
        expect(res.status).toBe(422);
        expect((res.body as Failure).message).toBe(
          'Give every seat in row 3 a ticket type. Every seat of a published event needs one.',
        );

        const typed = await layout({ seatTicketTypes: split() });
        expect(typed.status).toBe(200);
        expect(await rowTypes('7')).toEqual(split()[6]);
      });
    });
  });

  it('forbids configuring seating without evCreate (403)', async () => {
    const id = await createEvent(adminJwt, 'Guarded Event');
    const limitedJwt = await token(LIMITED, ORG.slug);
    await reserved(id, limitedJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 2,
    }).expect(403);
  });

  it("forbids configuring another tenant's event (404)", async () => {
    await reserved(foreignEventId, adminJwt, {
      name: 'Hall',
      rows: 2,
      seatsPerRow: 2,
    }).expect(404);
  });
});

const PERM_GROUP: Record<string, string> = {
  evCreate: 'Events',
  regView: 'Registrations',
};

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  people: { email: string; roleName: string; grants: string[] }[],
): Promise<void> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const orgId = Number(res.rows[0].id);
  const passwordHash = await hash(PASSWORD);
  for (const p of people) {
    for (const key of p.grants) {
      await pool.query(
        `INSERT INTO permissions (key, "group", label) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [key, PERM_GROUP[key], key],
      );
    }
    // `is_system` false: these are the spec's own roles, not the product's. The
    // Organizer here holds regView alone, so that configuring seating is refused
    // it; a built-in Organizer is reconciled against DEFAULT_ROLES at sign-in,
    // which would hand it evCreate and dissolve the 403 this spec asserts.
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description, is_system)
       VALUES ($1, $2, 'seed', false) RETURNING id`,
      [orgId, p.roleName],
    );
    const roleId = Number(role.rows[0].id);
    for (const key of p.grants) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
        [roleId, key],
      );
    }
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1, 'Seed', $2, 'admin', 'Active', $3) RETURNING id`,
      [orgId, p.email, passwordHash],
    );
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
       VALUES ($1, $2, $3, $4, 'Active')`,
      [orgId, user.rows[0].id, roleId, p.roleName],
    );
  }
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  // A booked seat's assignment restricts deleting the seat, so the orders
  // (and with them the tickets and assignments) go first.
  await pool.query(
    `DELETE FROM orders WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [slugs],
  );
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [slugs],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
