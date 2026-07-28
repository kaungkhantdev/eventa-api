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
const ORG_A = { slug: 'evt-e2e-a', name: 'Events E2E A' };
const ORG_B = { slug: 'evt-e2e-b', name: 'Events E2E B' };
const ADMIN_A = 'admin@evt-e2e-a.test';
const ADMIN_B = 'admin@evt-e2e-b.test';
const ATTENDEE_A = 'attendee@evt-e2e-a.test';

interface SuccessBody<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  meta?: { page: number; limit: number; total: number; totalPages: number };
}
interface EventData {
  id: string;
  slug: string;
  name: string;
  status: string;
  bucket: string;
}

describe('Events (e2e — create draft + list)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedTenant(pool, ORG_A, [
      { email: ADMIN_A, persona: 'admin' },
      { email: ATTENDEE_A, persona: 'attendee' },
    ]);
    await seedTenant(pool, ORG_B, [{ email: ADMIN_B, persona: 'admin' }]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const token = async (email: string, orgSlug: string, persona: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug, persona });
    return (res.body as SuccessBody<{ accessToken: string }>).data.accessToken;
  };

  const createEvent = (jwt: string, body: Record<string, unknown>) =>
    request(server)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  it('rejects an unauthenticated create with 401', async () => {
    const res = await request(server).post('/api/v1/events').send({
      name: 'No Auth',
      type: 'Conference',
      startAt: '2026-09-01T02:00:00Z',
    });
    expect(res.status).toBe(401);
  });

  it('creates a draft event and returns it in the success envelope', async () => {
    const jwt = await token(ADMIN_A, ORG_A.slug, 'admin');
    const res = await createEvent(jwt, {
      name: 'Bangkok Tech Conference 2026',
      type: 'Conference',
      startAt: '2026-09-01T02:00:00Z',
    });

    expect(res.status).toBe(201);
    const body = res.body as SuccessBody<EventData>;
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('draft');
    expect(body.data.bucket).toBe('active');
    expect(body.data.slug).toBe('bangkok-tech-conference-2026');
  });

  it('lists my events as a Paginated envelope', async () => {
    const jwt = await token(ADMIN_A, ORG_A.slug, 'admin');
    const res = await request(server)
      .get('/api/v1/events')
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(200);
    const body = res.body as SuccessBody<EventData[]>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ page: 1, limit: 20 });
    expect(
      body.data.some((e) => e.slug === 'bangkok-tech-conference-2026'),
    ).toBe(true);
  });

  it('excludes active drafts from the completed bucket', async () => {
    const jwt = await token(ADMIN_A, ORG_A.slug, 'admin');
    const res = await request(server)
      .get('/api/v1/events?bucket=completed')
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(200);
    const body = res.body as SuccessBody<EventData[]>;
    expect(body.data.every((e) => e.bucket === 'completed')).toBe(true);
  });

  it('forbids an attendee persona from creating events (403)', async () => {
    const jwt = await token(ATTENDEE_A, ORG_A.slug, 'attendee');
    const res = await createEvent(jwt, {
      name: 'Attendee Attempt',
      type: 'Conference',
      startAt: '2026-09-01T02:00:00Z',
    });
    expect(res.status).toBe(403);
  });

  it('does not leak events across tenants', async () => {
    const jwtB = await token(ADMIN_B, ORG_B.slug, 'admin');
    const res = await request(server)
      .get('/api/v1/events')
      .set('Authorization', `Bearer ${jwtB}`);

    const body = res.body as SuccessBody<EventData[]>;
    expect(
      body.data.some((e) => e.slug === 'bangkok-tech-conference-2026'),
    ).toBe(false);
  });
});

async function seedTenant(
  pool: Pool,
  org: { slug: string; name: string },
  people: { email: string; persona: 'admin' | 'attendee' }[],
): Promise<void> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const orgId = Number(res.rows[0].id);
  const passwordHash = await hash(PASSWORD);
  for (const p of people) {
    await pool.query(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1, 'Seed User', $2, $3, 'Active', $4)`,
      [orgId, p.email, p.persona, passwordHash],
    );
  }
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [
    [ORG_A.slug, ORG_B.slug],
  ]);
}
