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
import {
  CONTACT_AUDIT_TITLE,
  CONTACT_AUDIT_TYPE,
  contactAuditMeta,
} from '../src/modules/attendee-directory/attendee-contact.audit';
import { listenOnLoopback } from './support/loopback';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'contact-e2e', name: 'Contact E2E' };
const ORG2 = { slug: 'contact-e2e-2', name: 'Contact E2E 2' };
const ORGANIZER = 'organizer@contact-e2e.test';
const DOOR_STAFF = 'staff@contact-e2e.test';
const OUTSIDER = 'admin@contact-e2e-2.test';

/** Who the organizer is correcting. */
const ANAN = { name: 'Anan Suksawat', email: 'anan@contact.test' };
/** Already in the directory — the address the save must not be allowed to take. */
const MALEE = { name: 'Malee Chai', email: 'malee@contact.test' };
/** Removed, and still holding its address because the unique index says so. */
const DEPARTED = { name: 'Somchai Wong', email: 'somchai@contact.test' };

const NEW_NAME = 'Anan Suksawat-Pinto';
const NEW_EMAIL = 'anan.sp@contact.test';
const NEW_PHONE = '+66891112222';
const OLD_PHONE = '+66812345678';

interface Success<T> {
  data: T;
}
interface Attendee {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  ticketCount: number;
}
interface Failure {
  statusCode: number;
  message: string;
  errors?: { field: string; message: string }[];
}

describe('Keep attendee contact details current (e2e — US-REG-08)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let jwt: string;
  let ananId: number;
  let maleeId: number;
  let departedId: number;
  let orderId: string;
  let eventId: string;
  let tierId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, ORGANIZER, ['regView', 'regManage']);
    await seedMember(pool, orgId, DOOR_STAFF, 'Staff', ['regView']);
    await seedOrg(pool, ORG2, OUTSIDER, ['regView', 'regManage']);
    ({ eventId, tierId } = await seedEvent(pool, orgId));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;
    jwt = await token(ORGANIZER, ORG.slug);
  }, 30000);

  beforeEach(async () => {
    await reseedPeople();
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

  const patch = (id: number, body: object, bearer = jwt) =>
    request(server)
      .patch(`/api/v1/attendees/${id}`)
      .set('Authorization', `Bearer ${bearer}`)
      .send(body);

  const ok = (res: { body: unknown }) => (res.body as Success<Attendee>).data;
  const failed = (res: { body: unknown }) => res.body as Failure;

  describe('a valid change (AC1)', () => {
    it('saves the new details and answers with the directory row', async () => {
      const res = await patch(ananId, {
        name: NEW_NAME,
        email: NEW_EMAIL,
        phone: NEW_PHONE,
      });

      expect(res.status).toBe(200);
      expect(ok(res)).toMatchObject({
        id: ananId,
        name: NEW_NAME,
        email: NEW_EMAIL,
        phone: NEW_PHONE,
        // Still the row the list renders, aggregates and all.
        ticketCount: 1,
      });
    });

    it('shows the new details on the directory row the list returns', async () => {
      await patch(ananId, { name: NEW_NAME, email: NEW_EMAIL });

      const list = await request(server)
        .get(`/api/v1/attendees?search=${encodeURIComponent(NEW_EMAIL)}`)
        .set('Authorization', `Bearer ${jwt}`);
      const rows = (list.body as Success<Attendee[]>).data;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: ananId, name: NEW_NAME });
    });

    it('bumps the row’s version so a second save of the same form is refused', async () => {
      await patch(ananId, { name: NEW_NAME, version: 1 });

      const stale = await patch(ananId, { name: 'Someone Else', version: 1 });
      expect(stale.status).toBe(409);
      expect(failed(stale).message).toMatch(/reload/i);
    });
  });

  describe('the audit trail (AC1 + AC5)', () => {
    it('records one entry titled “Updated contact details”, naming the fields', async () => {
      await patch(ananId, { email: NEW_EMAIL, phone: NEW_PHONE });

      const entries = await pool.query<{ title: string; meta: string }>(
        `SELECT title, meta FROM audit_events
          WHERE organization_id = $1 AND type = $2 ORDER BY id DESC`,
        [orgId, CONTACT_AUDIT_TYPE],
      );
      expect(entries.rows).toHaveLength(1);
      expect(entries.rows[0].title).toBe(CONTACT_AUDIT_TITLE);
      expect(entries.rows[0].meta).toBe(
        contactAuditMeta(ananId, ['email', 'phone']),
      );
    });

    it('attributes the entry to the organizer who made the change', async () => {
      await patch(ananId, { phone: NEW_PHONE });

      const entry = await pool.query<{ email: string }>(
        `SELECT u.email FROM audit_events a
           JOIN users u ON u.id = a.actor_user_id
          WHERE a.organization_id = $1 AND a.type = $2`,
        [orgId, CONTACT_AUDIT_TYPE],
      );
      expect(entry.rows[0].email).toBe(ORGANIZER);
    });

    it('records nothing when the save moves no value', async () => {
      const res = await patch(ananId, {
        name: ANAN.name,
        email: ANAN.email,
        phone: OLD_PHONE,
      });

      expect(res.status).toBe(200);
      const entries = await pool.query(
        `SELECT 1 FROM audit_events WHERE organization_id = $1 AND type = $2`,
        [orgId, CONTACT_AUDIT_TYPE],
      );
      expect(entries.rowCount).toBe(0);
    });
  });

  describe('future confirmations and reminders (AC2)', () => {
    it('re-points the buyer contact every send path reads off the order', async () => {
      await patch(ananId, {
        name: NEW_NAME,
        email: NEW_EMAIL,
        phone: NEW_PHONE,
      });

      const order = await pool.query<{
        buyer_name: string;
        buyer_email: string;
        buyer_phone: string;
      }>(
        `SELECT buyer_name, buyer_email, buyer_phone FROM orders WHERE id = $1`,
        [orderId],
      );
      expect(order.rows[0]).toEqual({
        buyer_name: NEW_NAME,
        buyer_email: NEW_EMAIL,
        buyer_phone: NEW_PHONE,
      });
    });

    it('leaves the issued ticket’s holder name alone — a pass is a credential', async () => {
      await patch(ananId, { name: NEW_NAME });

      const ticket = await pool.query<{ holder_name: string }>(
        `SELECT holder_name FROM tickets WHERE order_id = $1`,
        [orderId],
      );
      expect(ticket.rows[0].holder_name).toBe(ANAN.name);
    });

    it('does not touch another attendee’s orders', async () => {
      await patch(ananId, { email: NEW_EMAIL });

      const others = await pool.query<{ buyer_email: string }>(
        `SELECT buyer_email FROM orders WHERE attendee_id = $1`,
        [maleeId],
      );
      expect(others.rows.every((r) => r.buyer_email === MALEE.email)).toBe(
        true,
      );
    });
  });

  describe('an address another attendee already holds (AC3)', () => {
    it('blocks the change and prompts a merge rather than overwriting', async () => {
      const res = await patch(ananId, { email: MALEE.email });

      expect(res.status).toBe(409);
      expect(failed(res).message).toMatch(/merge the two records/i);
      // Never the other person's address: a 4xx message is logged.
      expect(failed(res).message).not.toContain(MALEE.email);
    });

    it('applies nothing at all — not even the fields sent alongside', async () => {
      await patch(ananId, {
        name: NEW_NAME,
        phone: NEW_PHONE,
        email: MALEE.email,
      });

      const row = await pool.query<{ name: string; phone: string }>(
        `SELECT name, phone FROM attendees WHERE id = $1`,
        [ananId],
      );
      expect(row.rows[0]).toEqual({ name: ANAN.name, phone: OLD_PHONE });
    });

    it('catches a collision that differs only in capitalisation (citext)', async () => {
      const res = await patch(ananId, { email: MALEE.email.toUpperCase() });

      expect(res.status).toBe(409);
      expect(failed(res).message).toMatch(/merge/i);
    });

    it('refuses an address still held by a removed record, and says so', async () => {
      const res = await patch(ananId, { email: DEPARTED.email });

      expect(res.status).toBe(409);
      expect(failed(res).message).toMatch(/removed/i);
    });

    it('lets the attendee keep their own address', async () => {
      const res = await patch(ananId, {
        email: ANAN.email,
        phone: NEW_PHONE,
      });

      expect(res.status).toBe(200);
      expect(ok(res).email).toBe(ANAN.email);
    });
  });

  describe('invalid input (AC4)', () => {
    it('refuses an email with no @ and applies nothing', async () => {
      const res = await patch(ananId, { email: 'no-at-sign' });

      expect(res.status).toBe(400);
      expect(failed(res).errors?.[0].field).toBe('email');
      expect(failed(res).errors?.[0].message).toMatch(/email/i);
      await expectUnchanged();
    });

    it('refuses an empty name and applies nothing', async () => {
      const res = await patch(ananId, { name: '' });

      expect(res.status).toBe(400);
      expect(failed(res).errors?.[0].field).toBe('name');
      await expectUnchanged();
    });

    it('refuses a name that is only whitespace, as a field error', async () => {
      const res = await patch(ananId, { name: '   ' });

      expect(res.status).toBe(422);
      expect(failed(res).errors).toHaveLength(1);
      expect(failed(res).errors?.[0].field).toBe('name');
      expect(failed(res).errors?.[0].message).toMatch(/name/i);
      await expectUnchanged();
    });

    it('refuses a body that names no field to change', async () => {
      expect((await patch(ananId, {})).status).toBe(422);
    });

    it('refuses a field that is not the attendee’s to edit', async () => {
      expect((await patch(ananId, { tag: 'VIP' })).status).toBe(400);
    });
  });

  describe('authorization', () => {
    it('refuses a member who only holds regView', async () => {
      const staff = await token(DOOR_STAFF, ORG.slug);
      const res = await patch(ananId, { phone: NEW_PHONE }, staff);

      expect(res.status).toBe(403);
      expect(failed(res).message).toMatch(/regManage/);
      await expectUnchanged();
    });

    it('404s on another workspace’s attendee rather than editing it', async () => {
      const outsider = await token(OUTSIDER, ORG2.slug);
      const res = await patch(ananId, { phone: NEW_PHONE }, outsider);

      expect(res.status).toBe(404);
      await expectUnchanged();
    });

    it('404s on an attendee that was removed', async () => {
      expect((await patch(departedId, { phone: NEW_PHONE })).status).toBe(404);
    });

    it('refuses an unauthenticated caller', async () => {
      const res = await request(server)
        .patch(`/api/v1/attendees/${ananId}`)
        .send({ phone: NEW_PHONE });
      expect(res.status).toBe(401);
    });
  });

  async function expectUnchanged(): Promise<void> {
    const row = await pool.query<{
      name: string;
      email: string;
      phone: string;
    }>(`SELECT name, email, phone FROM attendees WHERE id = $1`, [ananId]);
    expect(row.rows[0]).toEqual({
      name: ANAN.name,
      email: ANAN.email,
      phone: OLD_PHONE,
    });
  }

  /** Every case starts from the same directory, so order never matters. */
  async function reseedPeople(): Promise<void> {
    await scopedDelete(
      pool,
      [ORG.slug],
      ['audit_events', 'tickets', 'order_items', 'orders', 'attendees'],
    );
    ananId = await insertAttendee(ANAN, OLD_PHONE, null);
    maleeId = await insertAttendee(MALEE, null, null);
    departedId = await insertAttendee(DEPARTED, null, new Date());
    orderId = await insertOrder(ananId, ANAN, OLD_PHONE);
    await insertOrder(maleeId, MALEE, null);
  }

  async function insertAttendee(
    person: { name: string; email: string },
    phone: string | null,
    deletedAt: Date | null,
  ): Promise<number> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO attendees (organization_id, name, email, phone, deleted_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [orgId, person.name, person.email, phone, deletedAt],
    );
    return Number(res.rows[0].id);
  }

  async function insertOrder(
    attendeeId: number,
    person: { name: string; email: string },
    phone: string | null,
  ): Promise<string> {
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, attendee_id, buyer_name,
                           buyer_email, buyer_phone, status, payment_status, seats,
                           subtotal_satang, total_satang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed','paid',1,0,0) RETURNING id`,
      [
        orgId,
        `ORD-CONTACT-${attendeeId}`,
        eventId,
        attendeeId,
        person.name,
        person.email,
        phone,
      ],
    );
    const item = await pool.query<{ id: string }>(
      `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                                unit_price_satang, line_subtotal_satang)
       VALUES ($1,$2,$3,1,0,0) RETURNING id`,
      [orgId, order.rows[0].id, tierId],
    );
    await pool.query(
      `INSERT INTO tickets (organization_id, order_id, order_item_id, event_id,
                            ticket_type_id, qr_token, holder_name, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'issued')`,
      [
        orgId,
        order.rows[0].id,
        item.rows[0].id,
        eventId,
        tierId,
        `qr-contact-${attendeeId}`,
        person.name,
      ],
    );
    return order.rows[0].id;
  }
});

const PERMISSION_GROUP = 'Registrations';

/** One upcoming event with a free tier — enough to own an order and a ticket. */
async function seedEvent(
  pool: Pool,
  orgId: number,
): Promise<{ eventId: string; tierId: string }> {
  const ev = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,'contact-summit','Contact Summit','Conference','active','live','public',
             now() + interval '30 days','Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId],
  );
  const eventId = ev.rows[0].id;
  const tier = await pool.query<{ id: string }>(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,'General',0,'onsale',100,0,1,8) RETURNING id`,
    [orgId, eventId],
  );
  return { eventId, tierId: tier.rows[0].id };
}

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  email: string,
  grants: string[],
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const orgId = Number(res.rows[0].id);
  await seedMember(pool, orgId, email, 'Admin', grants);
  return orgId;
}

/**
 * A member whose role grants exactly `grants`. `is_system` is forced false:
 * sign-in reconciles a built-in role named Admin/Organizer/Staff up to the full
 * grant set its name carries, which would widen the narrow grants a 403 test
 * depends on.
 */
async function seedMember(
  pool: Pool,
  orgId: number,
  email: string,
  roleName: string,
  grants: string[],
): Promise<void> {
  for (const key of grants) {
    await pool.query(
      `INSERT INTO permissions (key, "group", label) VALUES ($1,$2,$1)
       ON CONFLICT (key) DO NOTHING`,
      [key, PERMISSION_GROUP],
    );
  }
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description, is_system)
     VALUES ($1,$2,'seed',false) RETURNING id`,
    [orgId, `Seed ${roleName}`],
  );
  for (const key of grants) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_key, granted)
       VALUES ($1,$2,true)`,
      [Number(role.rows[0].id), key],
    );
  }
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1,'Seed',$2,'admin','Active',$3) RETURNING id`,
    [orgId, email, await hash(PASSWORD)],
  );
  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
     VALUES ($1,$2,$3,$4,'Active')`,
    [orgId, user.rows[0].id, Number(role.rows[0].id), roleName],
  );
}

async function scopedDelete(
  pool: Pool,
  slugs: string[],
  tables: string[],
): Promise<void> {
  const scoped = `organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`;
  for (const table of tables) {
    await pool.query(`DELETE FROM ${table} WHERE ${scoped}`, [slugs]);
  }
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  // audit_events leads: its organizations reference is ON DELETE RESTRICT, so
  // the delete below fails unless the trail is cleared first. tickets hold an
  // ON DELETE RESTRICT reference to events for the same reason.
  await scopedDelete(pool, slugs, [
    'audit_events',
    'check_ins',
    'tickets',
    'order_items',
    'orders',
    'ticket_types',
    'attendees',
    'events',
  ]);
  await pool.query(
    `DELETE FROM memberships WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [slugs],
  );
  await pool.query(
    `DELETE FROM role_permissions WHERE role_id IN
       (SELECT id FROM roles WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1)))`,
    [slugs],
  );
  await scopedDelete(pool, slugs, ['roles', 'users']);
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
