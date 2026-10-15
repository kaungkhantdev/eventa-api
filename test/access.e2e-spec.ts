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
  let orgId: number;
  let adminRoleId: number;
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
        // regCheckin because the Admin creates a Volunteer role granting it
        // below, and nobody may hand out a key they do not hold (US-SET-12).
        {
          name: 'Admin',
          grants: ['setUsers', 'evCreate', 'regView', 'regCheckin'],
        },
        { name: 'Organizer', grants: ['evCreate'] },
        { name: 'Staff', grants: ['regView'] },
      ],
      [
        { email: ADMIN, roleName: 'Admin' },
        { email: STAFF, roleName: 'Staff' },
      ],
    );
    orgId = seeded.orgId;
    adminRoleId = seeded.roleIdByName.Admin;
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
    await listenOnLoopback(app);
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

  /*
   * NFR-SUP-02: every permission change is recorded with who, when and from
   * where. The grant above is that change.
   */
  it('records the permission change in the audit trail, with who and from where', async () => {
    const rows = await permAudit(pool, orgId);
    const entry = rows.find(
      (r) => r.title === 'Changed the permissions of the Staff role',
    );

    expect(entry).toMatchObject({
      meta: 'Granted: Create & edit events',
      actorEmail: ADMIN,
    });
    expect(entry?.ipAddress).toBeTruthy();
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

  /*
   * US-SET-05: "Given a teammate's role was changed, when I open the audit log,
   * then I see an entry showing who changed it, from which role to which, and
   * when." The previous case moved STAFF from Staff to Organizer.
   */
  it('shows the role change in the audit log: who, from which role to which, and when', async () => {
    const jwt = await token(ADMIN);
    const res = await request(server)
      .get('/api/v1/audit')
      .query({ type: 'perm' })
      .set('Authorization', `Bearer ${jwt}`);

    expect(res.status).toBe(200);
    const entry = (
      res.body as Success<
        { title: string; actorName: string | null; occurredAt: string }[]
      >
    ).data.find(
      (e) => e.title === "Changed Seed User's role from Staff to Organizer",
    );
    expect(entry?.actorName).toBe('Seed User');
    expect(Number.isNaN(Date.parse(entry?.occurredAt ?? ''))).toBe(false);

    // Every seeded teammate is called "Seed User", so the name alone does not
    // say who: the row's actor is the Admin who made the change.
    const row = (await permAudit(pool, orgId)).find(
      (r) => r.title === "Changed Seed User's role from Staff to Organizer",
    );
    expect(row?.actorEmail).toBe(ADMIN);
    expect(row?.ipAddress).toBeTruthy();
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

  /*
   * US-SET-11: "Given the last remaining Admin, when I try to remove, suspend
   * or demote them (or myself), then the action is blocked." ADMIN is the only
   * Admin here, so demoting themselves is the case that would strand the
   * workspace.
   */
  it('refuses to demote the last Admin, even by themselves (409)', async () => {
    const jwt = await token(ADMIN);
    const admin = (await membersOf(jwt)).data.find((m) => m.email === ADMIN);

    const res = await request(server)
      .patch(`/api/v1/members/${admin?.id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ roleId: organizerRoleId });

    expect(res.status).toBe(409);
    const after = (await membersOf(jwt)).data.find((m) => m.email === ADMIN);
    expect(after?.role).toBe('Admin');
  });

  describe('custom roles (US-SET-13)', () => {
    it('creates a custom role with the chosen capabilities', async () => {
      const adminJwt = await token(ADMIN);
      const res = await request(server)
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({
          name: 'Volunteer',
          description: 'Helps on the day',
          permissions: ['regCheckin'],
        });
      expect(res.status).toBe(201);
      const role = (
        res.body as {
          data: { name: string; permissions: string[]; isSystem: boolean };
        }
      ).data;
      expect(role).toMatchObject({
        name: 'Volunteer',
        permissions: ['regCheckin'],
        isSystem: false,
      });
    });

    it('rejects a duplicate name and asks for a unique one (409)', async () => {
      const adminJwt = await token(ADMIN);
      const res = await request(server)
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ name: 'Volunteer', description: 'again', permissions: [] });
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(/unique name/i);
    });

    it('shows every role with its member count, and can be searched', async () => {
      const adminJwt = await token(ADMIN);
      const all = await request(server)
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${adminJwt}`);
      const roles = (
        all.body as { data: { name: string; memberCount: number }[] }
      ).data;
      expect(
        roles.find((r) => r.name === 'Admin')?.memberCount,
      ).toBeGreaterThan(0);
      expect(roles.find((r) => r.name === 'Volunteer')?.memberCount).toBe(0);

      const searched = await request(server)
        .get('/api/v1/roles?q=volun')
        .set('Authorization', `Bearer ${adminJwt}`);
      const found = (searched.body as { data: { name: string }[] }).data;
      expect(found.map((r) => r.name)).toEqual(['Volunteer']);
    });

    it('a custom role can be assigned to a teammate', async () => {
      const adminJwt = await token(ADMIN);
      const roles = await request(server)
        .get('/api/v1/roles?q=Volunteer')
        .set('Authorization', `Bearer ${adminJwt}`);
      const volunteerId = (roles.body as { data: { id: number }[] }).data[0].id;

      const invited = await request(server)
        .post('/api/v1/members')
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({
          name: 'Volunteer Vic',
          email: 'vic@access-e2e.test',
          roleId: volunteerId,
        });
      expect(invited.status).toBe(201);
      expect(
        (invited.body as { data: { member: { role: string } } }).data.member
          .role,
      ).toBe('Volunteer');
    });

    it('refuses to strip user management from the only role that grants it (409)', async () => {
      const adminJwt = await token(ADMIN);
      const roles = await request(server)
        .get('/api/v1/roles?q=Admin')
        .set('Authorization', `Bearer ${adminJwt}`);
      const adminRoleId = (roles.body as { data: { id: number }[] }).data[0].id;

      const res = await request(server)
        .put(`/api/v1/roles/${adminRoleId}/permissions`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ permissions: ['regView'] });
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(
        /manage users and roles/i,
      );
    });
  });

  describe('invite flow', () => {
    const INVITEE = 'invitee@access-e2e.test';
    // Letters AND a digit — the shared password rule every way of setting one
    // enforces. Without the digit every accept here was a 400 before the token
    // was even looked at.
    const INVITEE_PW = 'invitee-strong-password-1';
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

    /*
     * US-SET-11: "Given an email that's already INVITED, when I invite it
     * again, then the invitation is simply RE-SENT rather than duplicated."
     *
     * This asserted a 409 — the behaviour the criterion contradicts — because
     * `emailInOrg` answered a plain yes/no and never looked at status. A
     * teammate who lost their join link was refused with "already exists in
     * the workspace" and there was no way to give them another; the console's
     * "Send the invitation again" button had nothing it could call.
     */
    it('re-sends to an address that is still Invited, without duplicating', async () => {
      const jwt = await token(ADMIN);
      const res = await invite(jwt, INVITEE);

      expect(res.status).toBe(201);
      const data = (res.body as Success<InviteData>).data;
      expect(data.member.status).toBe('Invited');
      // A fresh token against the same person, not a second member.
      expect(typeof data.inviteToken).toBe('string');

      const members = await request(server)
        .get('/api/v1/members')
        .set('Authorization', `Bearer ${jwt}`)
        .query({ search: INVITEE });
      const rows = (members.body as Success<{ email: string }[]>).data;
      expect(rows.filter((m) => m.email === INVITEE)).toHaveLength(1);

      // The newest token is the one that works from here.
      inviteToken = data.inviteToken;
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

    /** The other half of the same criterion: an ACTIVE member is refused. */
    it('rejects re-inviting somebody who has already joined (409)', async () => {
      const jwt = await token(ADMIN);
      const res = await invite(jwt, INVITEE);

      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(
        /already exists in the workspace/i,
      );
    });

    it('rejects reusing an already-accepted invite token (401)', async () => {
      const res = await request(server)
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: INVITEE_PW });
      expect(res.status).toBe(401);
    });

    /*
     * US-SET-11: "Given a member who should leave, when I confirm removal,
     * then their access ends immediately … they can be re-invited later."
     *
     * Removal soft-deletes the user row and leaves its email in place, and
     * `uq_users_org_email_persona` used to cover deleted rows too — so the
     * re-invite inserted a duplicate (org, email, persona) and answered 500.
     */
    it('re-invites somebody who was removed (201, Invited again)', async () => {
      interface Member {
        id: number;
        status: string;
      }
      const LEAVER = 'leaver@access-e2e.test';
      const jwt = await token(ADMIN);
      const first = await invite(jwt, LEAVER);
      expect(first.status).toBe(201);
      const memberId = (first.body as Success<{ member: Member }>).data.member
        .id;

      await request(server)
        .delete(`/api/v1/members/${memberId}`)
        .set('Authorization', `Bearer ${jwt}`)
        .expect(200);

      const again = await invite(jwt, LEAVER);
      expect(again.status).toBe(201);
      const member = (again.body as Success<{ member: Member }>).data.member;
      expect(member.status).toBe('Invited');
      expect(member.id).not.toBe(memberId);
    });
  });

  /*
   * US-SET-12: "Given I try to grant myself more access than I currently have,
   * when I save, then it's blocked." PEOPLE manages users and roles and holds
   * nothing else — which used to count as holding everything.
   */
  describe('privilege escalation (US-SET-12)', () => {
    const PEOPLE = 'people@access-e2e.test';
    let peopleRoleId: number;
    let peopleMemberId: number;

    beforeAll(async () => {
      const role = await pool.query<{ id: string }>(
        `INSERT INTO roles (organization_id, name, description, is_system)
         VALUES ($1, 'People', 'seed', false) RETURNING id`,
        [orgId],
      );
      peopleRoleId = Number(role.rows[0].id);
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, granted)
         VALUES ($1, 'setUsers', true)`,
        [peopleRoleId],
      );
      const user = await pool.query<{ id: string }>(
        `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
         VALUES ($1, 'People Lead', $2, 'admin', 'Active', $3) RETURNING id`,
        [orgId, PEOPLE, await hash(PASSWORD)],
      );
      const member = await pool.query<{ id: string }>(
        `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
         VALUES ($1, $2, $3, 'People', 'Active') RETURNING id`,
        [orgId, user.rows[0].id, peopleRoleId],
      );
      peopleMemberId = Number(member.rows[0].id);
    });

    it('refuses to add a key the actor lacks to their own role (403)', async () => {
      const jwt = await token(PEOPLE);
      const res = await request(server)
        .put(`/api/v1/roles/${peopleRoleId}/permissions`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({ permissions: ['setUsers', 'evCreate'] });

      expect(res.status).toBe(403);
    });

    it('refuses to move the actor themselves onto the Admin role (403)', async () => {
      const jwt = await token(PEOPLE);
      const res = await request(server)
        .patch(`/api/v1/members/${peopleMemberId}`)
        .set('Authorization', `Bearer ${jwt}`)
        .send({ roleId: adminRoleId });

      expect(res.status).toBe(403);
      const after = (await membersOf(jwt)).data.find((m) => m.email === PEOPLE);
      expect(after?.role).toBe('People');
    });

    /*
     * US-SET-12: "Admin can do everything." A key taken off the Admin role is
     * one only an Admin could put back, so checking an Admin against their own
     * keys would leave it off for good.
     */
    it('lets an Admin put back a key they took off the Admin role', async () => {
      const jwt = await token(ADMIN);
      const put = (permissions: string[]) =>
        request(server)
          .put(`/api/v1/roles/${adminRoleId}/permissions`)
          .set('Authorization', `Bearer ${jwt}`)
          .send({ permissions });

      expect((await put(['setUsers', 'evCreate', 'regView'])).status).toBe(200);
      const restored = await put([
        'setUsers',
        'evCreate',
        'regView',
        'regCheckin',
      ]);

      expect(restored.status).toBe(200);
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
    // `is_system` defaults to TRUE, so a bare INSERT would have this fixture claim
    // to be a built-in role — and sign-in reconciles a built-in named Admin,
    // Organizer or Staff up to the full grant set its name carries, widening the
    // grants each case here holds on purpose. This role is the spec's own.
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description, is_system) VALUES ($1, $2, 'seed', false) RETURNING id`,
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

/** The workspace's permission-change audit rows, with the actor's email. */
async function permAudit(
  pool: Pool,
  orgId: number,
): Promise<
  {
    title: string;
    meta: string | null;
    actorEmail: string | null;
    ipAddress: string | null;
  }[]
> {
  const res = await pool.query<{
    title: string;
    meta: string | null;
    actor_email: string | null;
    ip_address: string | null;
  }>(
    `SELECT a.title, a.meta, u.email AS actor_email, a.ip_address
       FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.organization_id = $1 AND a.type = 'perm'
      ORDER BY a.id`,
    [orgId],
  );
  return res.rows.map((r) => ({
    title: r.title,
    meta: r.meta,
    actorEmail: r.actor_email,
    ipAddress: r.ip_address,
  }));
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
