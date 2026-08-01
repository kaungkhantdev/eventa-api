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
const ORG = { slug: 'access-e2e', name: 'Access E2E' };
const ORG2 = { slug: 'access-e2e-2', name: 'Access E2E 2' };
const ADMIN = 'admin@access-e2e.test';
const STAFF = 'staff@access-e2e.test';

const PERM_GROUP: Record<string, string> = {
  setUsers: 'Settings',
  evCreate: 'Events',
  regView: 'Registrations',
  regCheckin: 'Registrations',
};

interface Success<T> {
  data: T;
}
interface Role {
  id: number;
  name: string;
  permissions: string[];
}

describe('Access / RBAC management (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let staffRoleId: number;
  let organizerRoleId: number;
  let foreignRoleId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    const seeded = await seedOrg(
      pool,
      ORG,
      [
        { name: 'Admin', grants: ['setUsers', 'evCreate', 'regView'] },
        { name: 'Organizer', grants: ['evCreate'] },
        { name: 'Staff', grants: ['regView'] },
      ],
      [
        { email: ADMIN, roleName: 'Admin' },
        { email: STAFF, roleName: 'Staff' },
      ],
    );
    staffRoleId = seeded.roleIdByName.Staff;
    organizerRoleId = seeded.roleIdByName.Organizer;
    const other = await seedOrg(
      pool,
      ORG2,
      [{ name: 'Organizer', grants: ['evCreate'] }],
      [],
    );
    foreignRoleId = other.roleIdByName.Organizer;

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

  const token = async (email: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug: ORG.slug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  };

  it('lists the permission catalog for a setUsers admin', async () => {
    const jwt = await token(ADMIN);
    const res = await request(server)
      .get('/api/v1/permissions')
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    const keys = (res.body as Success<{ key: string }[]>).data.map(
      (p) => p.key,
    );
    expect(keys).toEqual(expect.arrayContaining(['setUsers', 'evCreate']));
  });

  it('lists roles with their granted keys', async () => {
    const jwt = await token(ADMIN);
    const res = await request(server)
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    const staff = (res.body as Success<Role[]>).data.find(
      (r) => r.id === staffRoleId,
    );
    expect(staff?.permissions).toEqual(['regView']);
  });

  it('forbids a user without setUsers from the RBAC endpoints (403)', async () => {
    const jwt = await token(STAFF);
    const res = await request(server)
      .get('/api/v1/roles')
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(403);
  });

  it('grants a permission to a role, and enforcement takes effect immediately', async () => {
    const staffJwt = await token(STAFF);
    // Staff lacks evCreate → cannot create events.
    await request(server)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${staffJwt}`)
      .send({
        name: 'Before Grant',
        type: 'Conference',
        startAt: '2026-09-01T02:00:00Z',
      })
      .expect(403);

    // Admin grants evCreate to the Staff role.
    const adminJwt = await token(ADMIN);
    const put = await request(server)
      .put(`/api/v1/roles/${staffRoleId}/permissions`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ permissions: ['regView', 'evCreate'] });
    expect(put.status).toBe(200);
    expect((put.body as Success<Role>).data.permissions).toEqual(
      expect.arrayContaining(['regView', 'evCreate']),
    );

    // Same staff token now passes (permissions are loaded per request).
    await request(server)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${staffJwt}`)
      .send({
        name: 'After Grant',
        type: 'Conference',
        startAt: '2026-09-01T02:00:00Z',
      })
      .expect(201);
  });

  it('revokes all permissions when given an empty set', async () => {
    const jwt = await token(ADMIN);
    const res = await request(server)
      .put(`/api/v1/roles/${staffRoleId}/permissions`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ permissions: [] });
    expect(res.status).toBe(200);
    expect((res.body as Success<Role>).data.permissions).toEqual([]);
  });

  it('rejects an unknown permission key with 400', async () => {
    const jwt = await token(ADMIN);
    const res = await request(server)
      .put(`/api/v1/roles/${staffRoleId}/permissions`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ permissions: ['notAKey'] });
    expect(res.status).toBe(400);
  });

  it('refuses to edit a role from another tenant (404)', async () => {
    const jwt = await token(ADMIN);
    const res = await request(server)
      .put(`/api/v1/roles/${foreignRoleId}/permissions`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ permissions: ['evCreate'] });
    expect(res.status).toBe(404);
  });

  const membersOf = async (jwt: string) =>
    (
      await request(server)
        .get('/api/v1/members')
        .set('Authorization', `Bearer ${jwt}`)
    ).body as Success<{ id: number; email: string; role: string }[]>;

  it('lists members with their role (paginated)', async () => {
    const jwt = await token(ADMIN);
    const res = await request(server)
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect((res.body as { meta?: unknown }).meta).toBeDefined();
    const staff = (
      res.body as Success<{ email: string; role: string }[]>
    ).data.find((m) => m.email === STAFF);
    expect(staff?.role).toBe('Staff');
  });

  it('assigns a member to another role', async () => {
    const jwt = await token(ADMIN);
    const members = await membersOf(jwt);
    const staff = members.data.find((m) => m.email === STAFF);

    const res = await request(server)
      .patch(`/api/v1/members/${staff?.id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ roleId: organizerRoleId });
    expect(res.status).toBe(200);
    expect((res.body as Success<{ role: string }>).data.role).toBe('Organizer');
  });

  it('refuses to assign a role from another tenant (404)', async () => {
    const jwt = await token(ADMIN);
    const members = await membersOf(jwt);
    const staff = members.data.find((m) => m.email === STAFF);

    const res = await request(server)
      .patch(`/api/v1/members/${staff?.id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ roleId: foreignRoleId });
    expect(res.status).toBe(404);
  });

  it('forbids the members endpoints without setUsers (403)', async () => {
    const jwt = await token(STAFF);
    const res = await request(server)
      .get('/api/v1/members')
      .set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(403);
  });

  describe('invite flow', () => {
    const INVITEE = 'invitee@access-e2e.test';
    const INVITEE_PW = 'invitee-strong-password';
    let inviteToken: string;

    interface InviteData {
      member: { status: string; role: string };
      inviteToken: string;
    }

    const invite = (jwt: string, email: string) =>
      request(server)
        .post('/api/v1/members')
        .set('Authorization', `Bearer ${jwt}`)
        .send({ name: 'Invitee', email, roleId: organizerRoleId });

    it('invites a teammate (Invited) and returns an invite token', async () => {
      const jwt = await token(ADMIN);
      const res = await invite(jwt, INVITEE);
      expect(res.status).toBe(201);
      const data = (res.body as Success<InviteData>).data;
      expect(data.member.status).toBe('Invited');
      expect(data.member.role).toBe('Organizer');
      expect(typeof data.inviteToken).toBe('string');
      inviteToken = data.inviteToken;
    });

    it('rejects a duplicate invite with 409', async () => {
      const jwt = await token(ADMIN);
      expect((await invite(jwt, INVITEE)).status).toBe(409);
    });

    it('cannot log in before accepting', async () => {
      const res = await request(server).post('/api/v1/auth/login').send({
        email: INVITEE,
        password: INVITEE_PW,
        orgSlug: ORG.slug,
        persona: 'admin',
      });
      expect(res.status).toBe(401);
    });

    it('rejects accepting with a bad token (401)', async () => {
      const res = await request(server)
        .post('/api/v1/auth/accept-invite')
        .send({ token: 'nonsense', password: INVITEE_PW });
      expect(res.status).toBe(401);
    });

    it('accepts the invite; the teammate can then log in and use their role', async () => {
      const accept = await request(server)
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: INVITEE_PW });
      expect(accept.status).toBe(200);
      expect((accept.body as Success<{ status: string }>).data.status).toBe(
        'Active',
      );

      const login = await request(server).post('/api/v1/auth/login').send({
        email: INVITEE,
        password: INVITEE_PW,
        orgSlug: ORG.slug,
        persona: 'admin',
      });
      expect(login.status).toBe(200);
      const jwt = (login.body as Success<{ accessToken: string }>).data
        .accessToken;

      // Organizer role grants evCreate → the new teammate can create events.
      await request(server)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          name: 'By Invitee',
          type: 'Conference',
          startAt: '2026-09-01T02:00:00Z',
        })
        .expect(201);
    });

    it('rejects reusing an already-accepted invite token (401)', async () => {
      const res = await request(server)
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: INVITEE_PW });
      expect(res.status).toBe(401);
    });
  });
});

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  rolesSpec: { name: string; grants: string[] }[],
  usersSpec: { email: string; roleName: string }[],
): Promise<{ orgId: number; roleIdByName: Record<string, number> }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const orgId = Number(res.rows[0].id);

  const allKeys = [...new Set(rolesSpec.flatMap((r) => r.grants))];
  for (const key of allKeys) {
    await pool.query(
      `INSERT INTO permissions (key, "group", label) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO NOTHING`,
      [key, PERM_GROUP[key], key],
    );
  }

  const roleIdByName: Record<string, number> = {};
  for (const spec of rolesSpec) {
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description) VALUES ($1, $2, 'seed') RETURNING id`,
      [orgId, spec.name],
    );
    const roleId = Number(role.rows[0].id);
    roleIdByName[spec.name] = roleId;
    for (const key of spec.grants) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
        [roleId, key],
      );
    }
  }

  const passwordHash = await hash(PASSWORD);
  for (const u of usersSpec) {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
       VALUES ($1, 'Seed User', $2, 'admin', 'Active', $3) RETURNING id`,
      [orgId, u.email, passwordHash],
    );
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
       VALUES ($1, $2, $3, $4, 'Active')`,
      [orgId, user.rows[0].id, roleIdByName[u.roleName], u.roleName],
    );
  }
  return { orgId, roleIdByName };
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  // audit_events is ON DELETE RESTRICT (a failed login writes one), so clear it first.
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [slugs],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
