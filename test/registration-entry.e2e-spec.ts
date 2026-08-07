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

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'entry-e2e', name: 'Entry E2E' };
const ORG2 = { slug: 'entry-e2e-2', name: 'Entry E2E 2' };
const ORGANIZER = 'organizer@entry-e2e.test';
const STAFF = 'staff@entry-e2e.test';
const ADMIN2 = 'admin@entry-e2e-2.test';
const BAHT = 100;
/** The platform cap the story quotes: "between 1 and 8 seats". */
const MAX_SEATS = 8;

interface Success<T> {
  data: T;
}
interface Added {
  orderId: string;
  reference: string;
  status: string;
  paymentStatus: string;
  totalSatang: number;
  vatSatang: number;
  amountLabel: string;
  ticketCount: number;
  paymentRequired: boolean;
}
interface Failure {
  message: string;
  errors?: { field: string; message: string }[];
}

describe('Adding a registration by hand (e2e — US-REG-03)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let freeEvent: string;
  let freeTier: string;
  let organizerJwt: string;
  let staffJwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      {
        email: ORGANIZER,
        roleName: 'Organizer',
        grants: ['regView', 'regManage'],
      },
      { email: STAFF, roleName: 'Staff', grants: ['regView'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['regView', 'regManage'] },
    ]);
    const seeded = await seedEvent(pool, orgId, 'entry-summit', {
      priceSatang: 0,
    });
    freeEvent = seeded.eventId;
    freeTier = seeded.tierId;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    organizerJwt = await token(ORGANIZER, ORG.slug);
    staffJwt = await token(STAFF, ORG.slug);
  }, 30000);

  afterEach(async () => {
    const orgs = [orgId, otherOrgId];
    for (const table of [
      'tickets',
      'seat_holds',
      'order_items',
      'orders',
      'attendees',
      'outbox_events',
      'audit_events',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
        orgs,
      ]);
    }
    await pool.query(
      `UPDATE ticket_types SET sold = 0, total = 100 WHERE organization_id = ANY($1)`,
      [orgs],
    );
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  async function token(email: string, orgSlug: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  }

  const add = (jwt: string, body: object) =>
    request(server)
      .post('/api/v1/registrations')
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  const entry = (o: Record<string, unknown> = {}) => ({
    eventId: freeEvent,
    ticketTypeId: freeTier,
    quantity: 2,
    name: 'Anan Suksawat',
    email: 'anan@entry.test',
    ...o,
  });

  describe('creating the booking', () => {
    it('confirms a free booking immediately, with a ticket and QR per seat', async () => {
      const res = await add(organizerJwt, entry());
      expect(res.status).toBe(201);
      const added = (res.body as Success<Added>).data;
      expect(added.status).toBe('confirmed');
      expect(added.ticketCount).toBe(2);
      expect(added.amountLabel).toBe('Free');
      expect(added.paymentRequired).toBe(false);

      const { rows } = await pool.query<{ qr_token: string }>(
        `SELECT qr_token FROM tickets WHERE order_id = $1`,
        [added.orderId],
      );
      expect(rows).toHaveLength(2);
      expect(rows.every((t) => t.qr_token.length > 0)).toBe(true);
    });

    it('reserves the seats against capacity', async () => {
      await add(organizerJwt, entry());
      const { rows } = await pool.query<{ sold: number }>(
        `SELECT sold FROM ticket_types WHERE id = $1`,
        [freeTier],
      );
      expect(rows[0].sold).toBe(2);
    });

    it('credits the organizer who entered it', async () => {
      const res = await add(organizerJwt, entry());
      const { orderId } = (res.body as Success<Added>).data;
      const { rows } = await pool.query<{ created_by: string | null }>(
        `SELECT created_by FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(rows[0].created_by).not.toBeNull();
    });

    it('adds the attendee to the directory, then reuses that record', async () => {
      await add(organizerJwt, entry());
      await add(organizerJwt, entry({ quantity: 1 }));
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM attendees WHERE organization_id = $1 AND email = $2`,
        [orgId, 'anan@entry.test'],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('prices a paid ticket automatically, VAT-inclusive, and awaits payment', async () => {
      const paid = await seedEvent(pool, orgId, 'entry-paid', {
        priceSatang: 1_000 * BAHT,
      });
      const res = await add(
        organizerJwt,
        entry({
          eventId: paid.eventId,
          ticketTypeId: paid.tierId,
          quantity: 1,
        }),
      );
      expect(res.status).toBe(201);
      const added = (res.body as Success<Added>).data;
      expect(added.status).toBe('pending');
      expect(added.paymentRequired).toBe(true);
      expect(added.totalSatang).toBeGreaterThan(0);
      expect(added.vatSatang).toBeGreaterThan(0);
      expect(added.amountLabel).not.toBe('Free');
      // Nothing is ticketed until the money is in — US-DISC-05's rule, reached
      // here through the same placement.
      expect(added.ticketCount).toBe(0);
    });
  });

  describe('the "Send confirmation" toggle', () => {
    it('queues the confirmation when it is on', async () => {
      const res = await add(organizerJwt, entry());
      const { orderId } = (res.body as Success<Added>).data;
      const { rows } = await pool.query<{ routing_key: string }>(
        `SELECT routing_key FROM outbox_events WHERE aggregate_id = $1`,
        [orderId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].routing_key).toBe('registration.confirmed');
    });

    it('creates the ticket quietly when it is off', async () => {
      const res = await add(organizerJwt, entry({ sendConfirmation: false }));
      const added = (res.body as Success<Added>).data;
      expect(added.ticketCount).toBe(2);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = $1`,
        [added.orderId],
      );
      expect(Number(rows[0].count)).toBe(0);
    });
  });

  describe('refusing a booking that cannot stand', () => {
    it('asks for 1–8 seats and reserves nothing when too many are requested', async () => {
      const res = await add(organizerJwt, entry({ quantity: MAX_SEATS + 1 }));
      expect(res.status).toBe(400);
      const { rows } = await pool.query<{ sold: number }>(
        `SELECT sold FROM ticket_types WHERE id = $1`,
        [freeTier],
      );
      expect(rows[0].sold).toBe(0);
    });

    it('says exactly how many are left, and makes no partial booking', async () => {
      await pool.query(
        `UPDATE ticket_types SET total = 5, sold = 3 WHERE id = $1`,
        [freeTier],
      );
      const res = await add(organizerJwt, entry({ quantity: 4 }));
      expect(res.status).toBe(409);
      expect((res.body as Failure).message).toMatch(/Only 2 left/i);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM orders WHERE organization_id = $1`,
        [orgId],
      );
      expect(Number(rows[0].count)).toBe(0);
    });

    it.each(['draft', 'completed', 'cancelled'])(
      'refuses a %s event — nothing to register for',
      async (status) => {
        const closed = await seedEvent(pool, orgId, `entry-${status}`, {
          priceSatang: 0,
          status,
        });
        const res = await add(
          organizerJwt,
          entry({ eventId: closed.eventId, ticketTypeId: closed.tierId }),
        );
        expect(res.status).toBe(404);
        expect((res.body as Failure).message).toMatch(/not open|isn't open/i);
      },
    );

    it('refuses an event in another workspace', async () => {
      const theirs = await seedEvent(pool, otherOrgId, 'entry-theirs', {
        priceSatang: 0,
      });
      const res = await add(
        organizerJwt,
        entry({ eventId: theirs.eventId, ticketTypeId: theirs.tierId }),
      );
      expect(res.status).toBe(404);
    });

    it('reports an invalid email as an inline field error', async () => {
      const res = await add(organizerJwt, entry({ email: 'not-an-email' }));
      expect(res.status).toBe(400);
      expect((res.body as Failure).errors?.[0].field).toBe('email');
    });

    it('reports a missing name as an inline field error', async () => {
      const res = await add(organizerJwt, entry({ name: '' }));
      expect(res.status).toBe(400);
      expect(
        (res.body as Failure).errors?.some((e) => e.field === 'name'),
      ).toBe(true);
    });

    it('403s Staff — adding a registration is not viewing the queue', async () => {
      const res = await add(staffJwt, entry());
      expect(res.status).toBe(403);
    });
  });
});

const PERM_GROUP: Record<string, string> = {
  regView: 'Registrations',
  regManage: 'Registrations',
};

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  people: { email: string; roleName: string; grants: string[] }[],
): Promise<number> {
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
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description) VALUES ($1, $2, 'seed') RETURNING id`,
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
  return orgId;
}

async function seedEvent(
  pool: Pool,
  orgId: number,
  slug: string,
  o: { priceSatang: number; status?: string },
): Promise<{ eventId: string; tierId: string }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,'Entry Summit','Conference','active',$3,'public',
             now() + interval '10 days', now() + interval '10 days' + interval '8 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId, slug, o.status ?? 'live'],
  );
  const eventId = res.rows[0].id;
  const tier = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,'General',$3,'onsale',100,0,1,8) RETURNING id`,
    [orgId, eventId, o.priceSatang],
  );
  return { eventId, tierId: tier.rows[0].id };
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  // Order matters: tickets reference events ON DELETE RESTRICT.
  for (const table of [
    'audit_events',
    'outbox_events',
    'tickets',
    'seat_holds',
    'order_items',
    'orders',
    'attendees',
    'ticket_types',
    'events',
  ]) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
