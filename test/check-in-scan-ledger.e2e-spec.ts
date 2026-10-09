process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import { createHash } from 'node:crypto';
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
const ORG = { slug: 'scanlog-e2e', name: 'Scan Ledger E2E' };
const STAFF = 'staff@scanlog-e2e.test';

interface Success<T> {
  data: T;
}
interface ScanResult {
  outcome: string;
  ticketId: string | null;
}
/** One `scan_attempts` row, as the ledger holds it. */
interface LedgerRow {
  outcome: string;
  method: string;
  ticket_id: string | null;
  ticket_event_id: string | null;
  token_fingerprint: string | null;
  station_id: string | null;
  scanned_by: string | null;
}

/**
 * The append-only scan ledger (e2e — US-REG-12, migration 0068).
 *
 * Asserted against the TABLE rather than an endpoint, because there is no read
 * API for it yet: the gap 0068 closes is that a refusal left no row at all, and
 * the row is the thing to prove. Everything here goes through the real door, so
 * it also proves the admission and its ledger row are written together.
 */
describe('The scan ledger at the door (e2e — US-REG-12)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let eventId: string;
  let otherEventId: string;
  let staffJwt: string;
  let seq = 0;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: STAFF, roleName: 'Staff', grants: ['regView', 'regCheckin'] },
    ]);
    // `live`, started an hour ago — the door is open.
    eventId = await seedEvent(pool, orgId, 'scanlog-summit');
    otherEventId = await seedEvent(pool, orgId, 'scanlog-other');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    staffJwt = await token(STAFF, ORG.slug);
  }, 30000);

  afterEach(async () => {
    // `scan_attempts` first: its `event_id` is ON DELETE RESTRICT, exactly as
    // `check_ins` is, so it has to go before anything that owns an event.
    for (const table of ['scan_attempts', 'check_ins', 'tickets', 'orders']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [
        [orgId],
      ]);
    }
    await pool.query(
      `DELETE FROM audit_events WHERE organization_id = ANY($1)`,
      [[orgId]],
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
    o: { event?: string; status?: string } = {},
  ): Promise<{ ticketId: string; qrToken: string }> {
    seq += 1;
    const event = o.event ?? eventId;
    const order = await pool.query<{ id: string }>(
      `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                           status, payment_status, seats, subtotal_satang, total_satang)
       VALUES ($1,$2,$3,'Anan Suksawat','anan@scanlog.test','confirmed','paid',1,0,0)
       RETURNING id`,
      [orgId, `ORD-SCANLOG-${seq}`, event],
    );
    const tier = await pool.query<{ id: string }>(
      `SELECT id FROM ticket_types WHERE event_id = $1 LIMIT 1`,
      [event],
    );
    const item = await pool.query<{ id: string }>(
      `INSERT INTO order_items (organization_id, order_id, ticket_type_id, quantity,
                                unit_price_satang, line_subtotal_satang)
       VALUES ($1,$2,$3,1,0,0) RETURNING id`,
      [orgId, order.rows[0].id, tier.rows[0].id],
    );
    const qrToken = `qr-scanlog-${seq}`;
    const ticket = await pool.query<{ id: string }>(
      `INSERT INTO tickets (organization_id, order_id, order_item_id, event_id,
                            ticket_type_id, qr_token, holder_name, ticket_label, status)
       VALUES ($1,$2,$3,$4,$5,$6,'Anan Suksawat','General',$7) RETURNING id`,
      [
        orgId,
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

  const scan = (body: object, event = eventId) =>
    request(server)
      .post(`/api/v1/events/${event}/check-ins/scan`)
      .set('Authorization', `Bearer ${staffJwt}`)
      .send(body);

  const admitManually = (body: object) =>
    request(server)
      .post(`/api/v1/events/${eventId}/check-ins`)
      .set('Authorization', `Bearer ${staffJwt}`)
      .send(body);

  /** The ledger, oldest first. */
  async function ledger(): Promise<LedgerRow[]> {
    const res = await pool.query<LedgerRow>(
      `SELECT outcome, method, ticket_id, ticket_event_id, token_fingerprint,
              station_id, scanned_by
         FROM scan_attempts
        WHERE organization_id = $1 AND event_id = $2
        ORDER BY id`,
      [orgId, eventId],
    );
    return res.rows;
  }

  const fingerprint = (token: string) =>
    createHash('sha256').update(token).digest('hex');

  describe('the enum finally has a column', () => {
    it('has exactly one column typed `scan_outcome` — 0039 left it with none', async () => {
      const res = await pool.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE udt_name = 'scan_outcome'`,
      );
      expect(res.rows).toEqual([
        { table_name: 'scan_attempts', column_name: 'outcome' },
      ]);
    });
  });

  describe('a refusal leaves a trace (the gap 0068 closes)', () => {
    it('records an unknown code, with no ticket and no event but ours', async () => {
      const res = await scan({ qrToken: 'not-a-ticket', stationId: 'door-7' });
      expect((res.body as Success<ScanResult>).data.outcome).toBe('invalid');
      expect(await ledger()).toEqual([
        expect.objectContaining({
          outcome: 'invalid',
          method: 'qr',
          ticket_id: null,
          ticket_event_id: null,
          token_fingerprint: fingerprint('not-a-ticket'),
          station_id: 'door-7',
        }),
      ]);
    });

    it('records WHICH event a wrong-event pass belonged to', async () => {
      const { ticketId, qrToken } = await seedTicket({ event: otherEventId });
      const res = await scan({ qrToken });
      expect((res.body as Success<ScanResult>).data.outcome).toBe(
        'wrong_event',
      );
      expect(await ledger()).toEqual([
        expect.objectContaining({
          outcome: 'wrong_event',
          ticket_id: ticketId,
          ticket_event_id: otherEventId,
        }),
      ]);
    });

    it('records a refunded pass without repeating this station’s event', async () => {
      // Null, not `eventId`: `ticket_event_id IS NOT NULL` has to mean "a pass
      // for somewhere else turned up here".
      const { ticketId, qrToken } = await seedTicket({ status: 'refunded' });
      const res = await scan({ qrToken });
      expect((res.body as Success<ScanResult>).data.outcome).toBe('cancelled');
      expect(await ledger()).toEqual([
        expect.objectContaining({
          outcome: 'cancelled',
          ticket_id: ticketId,
          ticket_event_id: null,
        }),
      ]);
    });

    it('tells one damaged pass presented repeatedly from many bad codes', async () => {
      // The question the fingerprint exists to answer, and the reason a refusal
      // cannot live on `check_ins`: three rows for one code, which
      // UNIQUE(ticket_id) could never have held.
      await scan({ qrToken: 'same-bad-code' });
      await scan({ qrToken: 'same-bad-code' });
      await scan({ qrToken: 'another-bad-code' });
      const grouped = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM scan_attempts
          WHERE organization_id = $1 AND token_fingerprint = $2`,
        [orgId, fingerprint('same-bad-code')],
      );
      expect(grouped.rows[0].n).toBe('2');
      expect(await ledger()).toHaveLength(3);
    });
  });

  describe('the raw token never lands in the ledger', () => {
    it('stores the digest and nothing resembling the code', async () => {
      const { qrToken } = await seedTicket();
      await scan({ qrToken });
      const row = (await ledger())[0];
      expect(row.token_fingerprint).toBe(fingerprint(qrToken));
      // Belt and braces over every text column: a bearer credential must not
      // be anywhere in an append-only table that outlives the ticket.
      const leak = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM scan_attempts
          WHERE organization_id = $1
            AND (token_fingerprint = $2 OR station_id = $2)`,
        [orgId, qrToken],
      );
      expect(leak.rows[0].n).toBe('0');
    });
  });

  describe('admissions are in it too, or there is no denominator', () => {
    it('records an admission beside its `check_ins` row, not instead of it', async () => {
      const { ticketId, qrToken } = await seedTicket();
      const res = await scan({ qrToken, stationId: 'door-1' });
      expect((res.body as Success<ScanResult>).data.outcome).toBe('admitted');
      expect(await ledger()).toEqual([
        expect.objectContaining({
          outcome: 'admitted',
          method: 'qr',
          ticket_id: ticketId,
          ticket_event_id: null,
          station_id: 'door-1',
        }),
      ]);
      // The admission itself is untouched by 0068 — still exactly one row.
      const admitted = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM check_ins WHERE ticket_id = $1`,
        [ticketId],
      );
      expect(admitted.rows[0].n).toBe('1');
    });

    it('records the second scan of one code as `already_checked_in`', async () => {
      const { qrToken } = await seedTicket();
      await scan({ qrToken });
      await scan({ qrToken });
      expect((await ledger()).map((r) => r.outcome)).toEqual([
        'admitted',
        'already_checked_in',
      ]);
    });

    it('records a manual admission with no fingerprint — no code was read', async () => {
      const { ticketId } = await seedTicket();
      await admitManually({ ticketId });
      expect(await ledger()).toEqual([
        expect.objectContaining({
          outcome: 'admitted',
          method: 'manual',
          ticket_id: ticketId,
          token_fingerprint: null,
        }),
      ]);
    });

    it('names the staff member who scanned', async () => {
      const { qrToken } = await seedTicket();
      await scan({ qrToken });
      expect((await ledger())[0].scanned_by).not.toBeNull();
    });
  });

  describe('append-only: it is history, not state', () => {
    it('keeps the `admitted` row after an undo — the scan did happen', async () => {
      // `check_ins` is the state of the room and the undo empties it; the
      // ledger is the history of the door and must not be rewritten.
      const { ticketId, qrToken } = await seedTicket();
      await scan({ qrToken });
      await request(server)
        .delete(`/api/v1/events/${eventId}/check-ins/${ticketId}`)
        .set('Authorization', `Bearer ${staffJwt}`)
        .expect(200);
      const admitted = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM check_ins WHERE ticket_id = $1`,
        [ticketId],
      );
      expect(admitted.rows[0].n).toBe('0');
      // One row, and still `admitted` — an undo is not a scan and writes none.
      expect(await ledger()).toEqual([
        expect.objectContaining({ outcome: 'admitted', ticket_id: ticketId }),
      ]);
    });

    it('survives the ticket being hard-deleted, losing only the pointer', async () => {
      // ON DELETE SET NULL, not CASCADE: erasing a ticket must not erase the
      // evidence that it was turned away at a door.
      const { ticketId, qrToken } = await seedTicket({ status: 'refunded' });
      await scan({ qrToken });
      await pool.query(`DELETE FROM tickets WHERE id = $1`, [ticketId]);
      expect(await ledger()).toEqual([
        expect.objectContaining({ outcome: 'cancelled', ticket_id: null }),
      ]);
    });

    it('refuses to let an event be deleted out from under its scan history', async () => {
      // ON DELETE RESTRICT, matching 0041's choice for `check_ins.event_id`.
      await scan({ qrToken: 'not-a-ticket' });
      await expect(
        pool.query(`DELETE FROM events WHERE id = $1`, [eventId]),
      ).rejects.toThrow(/scan_attempts/);
    });
  });

  describe('a shut door is not a scan', () => {
    it('writes nothing when check-in is not open', async () => {
      const shut = await seedEvent(pool, orgId, 'scanlog-draft', {
        status: 'draft',
      });
      await request(server)
        .post(`/api/v1/events/${shut}/check-ins/scan`)
        .set('Authorization', `Bearer ${staffJwt}`)
        .send({ qrToken: 'not-a-ticket' })
        .expect(409);
      const res = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM scan_attempts WHERE event_id = $1`,
        [shut],
      );
      expect(res.rows[0].n).toBe('0');
      await pool.query(`DELETE FROM ticket_types WHERE event_id = $1`, [shut]);
      await pool.query(`DELETE FROM events WHERE id = $1`, [shut]);
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
    // `is_system` defaults to TRUE, and sign-in reconciles a built-in role
    // named Staff up to the full grant set that name carries — which would
    // widen the grants this spec sets on purpose. This role is the spec's own.
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description, is_system)
       VALUES ($1, $2, 'seed', false) RETURNING id`,
      [orgId, p.roleName],
    );
    const roleId = Number(role.rows[0].id);
    for (const key of p.grants) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, granted)
         VALUES ($1, $2, true)`,
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
  o: { status?: string } = {},
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, end_at, timezone, organizer_name, venue_name, city, published_at)
     VALUES ($1,$2,'Scan Ledger Summit','Conference','active',$3,'public',
             now() - interval '1 hour', now() + interval '7 hours',
             'Asia/Bangkok','Acme','QSNCC','Bangkok', now())
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
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  // Order matters: scan_attempts, check_ins and tickets all reference events
  // ON DELETE RESTRICT.
  for (const table of [
    'scan_attempts',
    'check_ins',
    'tickets',
    'order_items',
    'orders',
    'ticket_types',
    'events',
  ]) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = $1)`,
      [ORG.slug],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
