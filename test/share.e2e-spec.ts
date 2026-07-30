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
const ORG = { slug: 'share-e2e', name: 'Share E2E' };
const ORG2 = { slug: 'share-e2e-2', name: 'Share E2E 2' };
const ADMIN = 'admin@share-e2e.test'; // evCreate
const LIMITED = 'staff@share-e2e.test'; // regView only
const ADMIN2 = 'admin@share-e2e-2.test';

interface Success<T> {
  data: T;
}
interface Share {
  publicUrl: string;
  registrationUrl: string;
  shareMessage: string;
  channels: {
    facebook: string;
    x: string;
    line: string;
    whatsapp: string;
    email: string;
  };
  isPublic: boolean;
  warning: string | null;
}

describe('Share / promote (e2e — US-EVT-15)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;
  let eventId: string;
  let foreignEventId: string;

  const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

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
    await app.init();
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, ORG.slug);
    eventId = await createEvent(adminJwt, 'Tech Conf');
    await request(server)
      .patch(`/api/v1/events/${eventId}`)
      .set(auth(adminJwt))
      .send({ venueName: 'Grand Hall' })
      .expect(200);
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
      .set(auth(jwt))
      .send({ name, type: 'Conference', startAt: '2026-09-01T02:00:00Z' });
    return (res.body as Success<{ id: string }>).data.id;
  }

  const share = (id: string, jwt: string) =>
    request(server).get(`/api/v1/events/${id}/share`).set(auth(jwt));

  it('returns the public link, message and channels, warning a draft is not public', async () => {
    const res = await share(eventId, adminJwt);
    expect(res.status).toBe(200);
    const s = (res.body as Success<Share>).data;
    expect(s.publicUrl).toContain('/e/tech-conf');
    expect(s.registrationUrl).toBe(s.publicUrl);
    expect(s.shareMessage).toMatch(/^Join me at Tech Conf/);
    expect(s.shareMessage).toContain('Grand Hall');
    expect(s.channels.facebook).toContain('facebook.com');
    expect(s.channels.whatsapp).toContain('wa.me');
    expect(s.channels.email.startsWith('mailto:')).toBe(true);
    // Still a draft → not publicly reachable.
    expect(s.isPublic).toBe(false);
    expect(s.warning).toMatch(/public/i);
  });

  it('drops the warning once the event is publicly reachable', async () => {
    await pool.query(
      `UPDATE events SET status = 'upcoming', visibility = 'public' WHERE id = $1`,
      [eventId],
    );
    const res = await share(eventId, adminJwt);
    const s = (res.body as Success<Share>).data;
    expect(s.isPublic).toBe(true);
    expect(s.warning).toBeNull();
  });

  it('forbids share links without evCreate (403)', async () => {
    const limitedJwt = await token(LIMITED, ORG.slug);
    await share(eventId, limitedJwt).expect(403);
  });

  it("forbids sharing another tenant's event (404)", async () => {
    await share(foreignEventId, adminJwt).expect(404);
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
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [slugs],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
