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
const ORG = { slug: 'chk-e2e', name: 'Check-in E2E' };
const ORG2 = { slug: 'chk-e2e-2', name: 'Check-in E2E 2' };
const STAFF = 'staff@chk-e2e.test';
const VIEWER = 'viewer@chk-e2e.test';
const ADMIN2 = 'admin@chk-e2e-2.test';

interface Success<T> {
  data: T;
}
interface ScanResult {
  outcome: string;
  ticketId: string | null;
  holderName: string | null;
  checkedInAt: string | null;
}

describe('Check-in at the door (e2e — US-REG-11/12/13)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let eventId: string;
  let otherEventId: string;
  let staffJwt: string;
  let viewerJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: STAFF, roleName: 'Staff', grants: ['regView', 'regCheckin'] },
      { email: VIEWER, roleName: 'Viewer', grants: ['regView'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['regView', 'regCheckin'] },
    ]);
    // `live`, started an hour ago — the door is open.
    eventId = await seedEvent(pool, orgId, 'chk-summit');
    otherEventId = await seedEvent(pool, otherOrgId, 'chk-other');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    staffJwt = await token(STAFF, ORG.slug);
    viewerJwt = await token(VIEWER, ORG.slug);
  }, 30000);

  afterEach(async () => {
    await pool.query(`DELETE FROM check_ins WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
    await pool.query(`DELETE FROM tickets WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
    await pool.query(`DELETE FROM orders WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
    await pool.query(
      `DELETE FROM audit_events WHERE organization_id = ANY($1)`,
      [[orgId, otherOrgId]],
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

  /** A confirmed order with one issued ticket, ready to walk through the door. */
  async function seedTicket(
    o: { org?: number; event?: string; status?: string } = {},
  ): Promise<{ ticketId: string; qrToken: string }> {
    seq += 1;
    const org = o.org ?? orgId;
    const event = o.event ?? eventId;
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang, total_satang)
       VALUES ($1,$2,$3,'Anan Suksawat','anan@chk.test','confirmed','paid',1,0,0)
       RETURNING id`,
      [org, `ORD-CHK-${seq}`, event],
    );
    const tier = await pool.query<{ id: string }>(
      `SELECT id FROM ticket_types WHERE event_id = $1 LIMIT 1`,
      [event],
    );
    const item = await pool.query<{ id: string }>(
      `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                                unit_price_satang, line_subtotal_satang)
       VALUES ($1,$2,$3,1,0,0) RETURNING id`,
      [org, order.rows[0].id, tier.rows[0].id],
    );
    const qrToken = `qr-chk-${seq}-${org}`;
    const ticket = await pool.query<{ id: string }>(
      `INSERT INTO tickets (organization_id, order_id, order_item_id, event_id,
                            ticket_type_id, qr_token, holder_name, ticket_label, status)
       VALUES ($1,$2,$3,$4,$5,$6,'Anan Suksawat','General',$7) RETURNING id`,
      [
        org,
        order.rows[0].id,
        item.rows[0].id,
        event,
        tier.rows[0].id,
        qrToken,
        o.status ?? 'issued',
      ],
    );
    return { ticketId: ticket.rows[0].id, qrToken };
  }

  const scan = (jwt: string, event: string, body: object) =>
    request(server)
      .post(`/api/v1/events/${event}/check-ins/scan`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  describe('scanning (US-REG-12)', () => {
    it('admits a valid unused ticket for this event', async () => {
      const { qrToken } = await seedTicket();
      const res = await scan(staffJwt, eventId, {
        qrToken,
        stationId: 'door-1',
      });
      expect(res.status).toBe(200);
      const result = (res.body as Success<ScanResult>).data;
      expect(result.outcome).toBe('admitted');
      expect(result.holderName).toBe('Anan Suksawat');
      expect(result.checkedInAt).not.toBeNull();
    });

    it('reports the ORIGINAL arrival on a second scan and admits nobody twice', async () => {
      const { qrToken } = await seedTicket();
      const first = (await scan(staffJwt, eventId, { qrToken }))
        .body as Success<ScanResult>;
      const second = (await scan(staffJwt, eventId, { qrToken }))
        .body as Success<ScanResult>;
      expect(second.data.outcome).toBe('already_checked_in');
      expect(second.data.checkedInAt).toBe(first.data.checkedInAt);
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM check_ins WHERE organization_id = $1`,
        [orgId],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('admits exactly once when the same code is read concurrently', async () => {
      // A code held steady in front of a camera fires repeatedly; the unique
      // constraint, not the application, is what makes this safe.
      const { qrToken } = await seedTicket();
      const results = await Promise.all([
        scan(staffJwt, eventId, { qrToken }),
        scan(staffJwt, eventId, { qrToken }),
        scan(staffJwt, eventId, { qrToken }),
      ]);
      const outcomes = results.map(
        (r) => (r.body as Success<ScanResult>).data.outcome,
      );
      expect(outcomes.filter((o) => o === 'admitted')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'already_checked_in')).toHaveLength(
        2,
      );
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM check_ins WHERE organization_id = $1`,
        [orgId],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('refuses a QR that is not a ticket', async () => {
      const res = await scan(staffJwt, eventId, { qrToken: 'not-a-ticket' });
      expect((res.body as Success<ScanResult>).data.outcome).toBe('invalid');
    });

    it('refuses a real ticket from another event', async () => {
      // Seeded in THIS org but on a different event, so it is a genuine
      // wrong-event case rather than a tenancy miss.
      const otherLocal = await seedEvent(pool, orgId, `chk-second-${seq}`);
      const { qrToken } = await seedTicket({ event: otherLocal });
      const res = await scan(staffJwt, eventId, { qrToken });
      expect((res.body as Success<ScanResult>).data.outcome).toBe(
        'wrong_event',
      );
    });

    it('refuses a refunded ticket — entry denied', async () => {
      const { qrToken } = await seedTicket({ status: 'refunded' });
      const res = await scan(staffJwt, eventId, { qrToken });
      expect((res.body as Success<ScanResult>).data.outcome).toBe('cancelled');
    });

    it('never resolves a ticket belonging to another workspace', async () => {
      const { qrToken } = await seedTicket({
        org: otherOrgId,
        event: otherEventId,
      });
      const res = await scan(staffJwt, eventId, { qrToken });
      expect((res.body as Success<ScanResult>).data.outcome).toBe('invalid');
    });
  });

  describe('by hand and undo (US-REG-11/13)', () => {
    it('admits by ticket id when the QR will not scan', async () => {
      const { ticketId } = await seedTicket();
      const res = await request(server)
        .post(`/api/v1/events/${eventId}/check-ins`)
        .set('Authorization', `Bearer ${staffJwt}`)
        .send({ ticketId });
      expect(res.status).toBe(200);
      expect((res.body as Success<ScanResult>).data.outcome).toBe('admitted');
      const { rows } = await pool.query<{ method: string }>(
        `SELECT method FROM check_ins WHERE ticket_id = $1`,
        [ticketId],
      );
      expect(rows[0].method).toBe('manual');
    });

    it('undoes an admission and puts the ticket back', async () => {
      const { ticketId, qrToken } = await seedTicket();
      await scan(staffJwt, eventId, { qrToken });
      await request(server)
        .delete(`/api/v1/events/${eventId}/check-ins/${ticketId}`)
        .set('Authorization', `Bearer ${staffJwt}`)
        .expect(200);

      const { rows: gone } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM check_ins WHERE ticket_id = $1`,
        [ticketId],
      );
      expect(Number(gone[0].count)).toBe(0);
      const { rows: ticket } = await pool.query<{
        status: string;
        checked_in_at: Date | null;
      }>(`SELECT status, checked_in_at FROM tickets WHERE id = $1`, [ticketId]);
      expect(ticket[0].status).toBe('issued');
      expect(ticket[0].checked_in_at).toBeNull();
      // The ledger row is gone, so the audit trail is the only evidence left.
      const { rows: audit } = await pool.query<{ title: string }>(
        `SELECT title FROM audit_events WHERE organization_id = $1 AND type = 'checkin'`,
        [orgId],
      );
      expect(audit[0].title).toMatch(/Undid check-in/);
    });

    it('refuses to undo something never checked in', async () => {
      const { ticketId } = await seedTicket();
      await request(server)
        .delete(`/api/v1/events/${eventId}/check-ins/${ticketId}`)
        .set('Authorization', `Bearer ${staffJwt}`)
        .expect(404);
    });

    it('re-admits after an undo, and the arrival time is the new one', async () => {
      const { ticketId, qrToken } = await seedTicket();
      const first = (await scan(staffJwt, eventId, { qrToken }))
        .body as Success<ScanResult>;
      await request(server)
        .delete(`/api/v1/events/${eventId}/check-ins/${ticketId}`)
        .set('Authorization', `Bearer ${staffJwt}`)
        .expect(200);
      const again = await scan(staffJwt, eventId, { qrToken });
      expect((again.body as Success<ScanResult>).data.outcome).toBe('admitted');
      expect(first.data.checkedInAt).not.toBeNull();
    });
  });

  describe('who may work the door', () => {
    it('denies a member with view access but no check-in permission', async () => {
      const { qrToken } = await seedTicket();
      expect((await scan(viewerJwt, eventId, { qrToken })).status).toBe(403);
    });

    it('refuses an unauthenticated caller', async () => {
      const res = await request(server)
        .post(`/api/v1/events/${eventId}/check-ins/scan`)
        .send({ qrToken: 'x' });
      expect(res.status).toBe(401);
    });

    it('404s an event from another workspace', async () => {
      const res = await scan(staffJwt, otherEventId, { qrToken: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('the door has to be open', () => {
    it('refuses when the event has not opened yet', async () => {
      const future = await seedEvent(pool, orgId, `chk-future-${seq}`, {
        startsInDays: 30,
      });
      const { qrToken } = await seedTicket({ event: future });
      const res = await scan(staffJwt, future, { qrToken });
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(
        /not open|closed/i,
      );
    });

    it('refuses a draft event outright', async () => {
      const draft = await seedEvent(pool, orgId, `chk-draft-${seq}`, {
        status: 'draft',
      });
      const { qrToken } = await seedTicket({ event: draft });
      expect((await scan(staffJwt, draft, { qrToken })).status).toBe(409);
    });
  });
});

const PERM_GROUP: Record<string, string> = {
  regView: 'Registrations',
  regCheckin: 'Registrations',
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
  o: { status?: string; startsInDays?: number } = {},
): Promise<string> {
  const start =
    o.startsInDays === undefined
      ? `now() - interval '1 hour'`
      : `now() + interval '${o.startsInDays} days'`;
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,'Check-in Summit','Conference','active',$3,'public',
             ${start}, ${start} + interval '8 hours','Asia/Bangkok','Acme','QSNCC','Bangkok', now())
     RETURNING id`,
    [orgId, slug, o.status ?? 'live'],
  );
  const eventId = res.rows[0].id;
  await pool.query(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               status, total, sold, min_per_order, max_per_order)
     VALUES ($1,$2,'General',0,'onsale',100,0,1,8)`,
    [orgId, eventId],
  );
  return eventId;
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [[ORG.slug, ORG2.slug]],
  );
  await pool.query(
    `DELETE FROM check_ins WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [[ORG.slug, ORG2.slug]],
  );
  await pool.query(
    `DELETE FROM events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [[ORG.slug, ORG2.slug]],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [
    [ORG.slug, ORG2.slug],
  ]);
}
