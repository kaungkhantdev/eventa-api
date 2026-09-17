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
const ORG = { slug: 'org-e2e', name: 'Org E2E' };
const ADMIN = 'admin@org-e2e.test'; // setSettings
const STAFF = 'staff@org-e2e.test'; // no setSettings

const PERM_GROUP: Record<string, string> = {
  setSettings: 'Settings',
  regView: 'Registrations',
};

interface Success<T> {
  data: T;
}
interface Org {
  id: number;
  name: string;
  address: string | null;
  website: string | null;
  taxId: string | null;
  vatRatePercent: number;
  statementDescriptor: string | null;
  version: number;
}

describe('Organization settings (e2e — US-SET-07)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminJwt: string;
  let staffJwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['setSettings'] },
      { email: STAFF, roleName: 'Staff', grants: ['regView'] },
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;

    adminJwt = await login(ADMIN);
    staffJwt = await login(STAFF);
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const login = async (email: string): Promise<string> => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug: ORG.slug });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  };

  const get = (jwt: string) =>
    request(server)
      .get('/api/v1/organization')
      .set('Authorization', `Bearer ${jwt}`);

  const patch = (jwt: string, body: Record<string, unknown>) =>
    request(server)
      .patch('/api/v1/organization')
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  it('any member can read the workspace identity, VAT itemized at 7%', async () => {
    const res = await get(staffJwt);
    expect(res.status).toBe(200);
    const org = (res.body as Success<Org>).data;
    expect(org.name).toBe(ORG.name);
    expect(org.vatRatePercent).toBe(7);
  });

  it('an Admin saves the legal name, address and 13-digit Thai tax ID', async () => {
    const res = await patch(adminJwt, {
      name: 'Org E2E Co., Ltd.',
      address: '99 Sukhumvit Rd, Bangkok 10110',
      website: 'https://org-e2e.co.th',
      taxId: '0105556012345',
      statementDescriptor: 'ORG E2E',
    });
    expect(res.status).toBe(200);
    const org = (res.body as Success<Org>).data;
    expect(org).toMatchObject({
      name: 'Org E2E Co., Ltd.',
      taxId: '0105556012345',
      website: 'https://org-e2e.co.th',
      statementDescriptor: 'ORG E2E',
    });
    // and it persisted
    expect((await get(adminJwt)).body).toMatchObject({
      data: { taxId: '0105556012345' },
    });
  });

  it('rejects an invalid tax ID and saves nothing (422)', async () => {
    const res = await patch(adminJwt, { taxId: '12345' });
    expect(res.status).toBe(422);
    const after = (await get(adminJwt)).body as Success<Org>;
    expect(after.data.taxId).toBe('0105556012345'); // unchanged
  });

  it('rejects a non-http website and saves nothing (422)', async () => {
    const res = await patch(adminJwt, { website: 'javascript:alert(1)' });
    expect(res.status).toBe(422);
    const after = (await get(adminJwt)).body as Success<Org>;
    expect(after.data.website).toBe('https://org-e2e.co.th');
  });

  it('rejects a statement descriptor longer than 22 chars (400 — DTO)', async () => {
    const res = await patch(adminJwt, {
      statementDescriptor: 'A'.repeat(23),
    });
    expect(res.status).toBe(400);
  });

  it('forbids a member without setSettings from changing it (403)', async () => {
    const res = await patch(staffJwt, { name: 'Hacked' });
    expect(res.status).toBe(403);
    const after = (await get(adminJwt)).body as Success<Org>;
    expect(after.data.name).toBe('Org E2E Co., Ltd.');
  });

  it('a partial save never blanks the other fields', async () => {
    await patch(adminJwt, { name: 'Org E2E Holdings' });
    const after = (await get(adminJwt)).body as Success<Org>;
    expect(after.data).toMatchObject({
      name: 'Org E2E Holdings',
      taxId: '0105556012345',
      address: '99 Sukhumvit Rd, Bangkok 10110',
    });
  });

  /**
   * The settings form reads a version and hands it back. Only the HTTP layer
   * proves this: the whitelist pipe rejects any property the DTO does not
   * declare, so an accepted field is a contract fact, not a service one.
   */
  describe('optimistic concurrency', () => {
    it('accepts the version it handed out', async () => {
      const before = ((await get(adminJwt)).body as Success<Org>).data.version;
      const res = await patch(adminJwt, {
        name: 'Org E2E Versioned',
        version: before,
      });

      expect(res.status).toBe(200);
      // Bumped, so the very same form cannot be submitted a second time.
      expect((res.body as Success<Org>).data.version).toBe(before + 1);
    });

    it('refuses a form opened before somebody else’s edit (409)', async () => {
      const before = ((await get(adminJwt)).body as Success<Org>).data.version;
      await patch(adminJwt, { name: 'First writer wins', version: before });

      const res = await patch(adminJwt, {
        name: 'Second writer',
        version: before,
      });
      expect(res.status).toBe(409);

      const after = (await get(adminJwt)).body as Success<Org>;
      expect(after.data.name).toBe('First writer wins');
    });
  });

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
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
