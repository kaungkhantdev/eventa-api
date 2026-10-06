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
import { PERMISSION_CATALOG } from '../src/modules/access/workspace-defaults';
import { listenOnLoopback } from './support/loopback';

/**
 * What `role_permissions` records, and what nothing may write behind an
 * organizer's back.
 *
 * Three states, and the whole feature is that they stay distinguishable:
 * a row with `granted = true` means the role holds the key; a row with
 * `granted = false` means somebody turned it off; NO ROW means nobody has ever
 * been asked about this key for this role. The third is the one the roles
 * editor has to surface, because nothing grants a permission automatically any
 * more — an automatic backfill was tried twice and both designs reversed
 * decisions organizers had made, so the gap is now shown to a person instead.
 *
 * These assertions are about SQL (an upsert over the catalog, a tombstone, what
 * a sign-in does and does not touch), so they run against the real database
 * rather than in a unit spec, where a mocked driver would only prove the mock
 * agrees with itself.
 */
const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'role-grants-e2e', name: 'Role Grants E2E' };
const YOUNG_ORG = { slug: 'role-grants-e2e-2', name: 'Role Grants E2E 2' };
const ADMIN = 'admin@role-grants-e2e.test';
const YOUNG_ADMIN = 'admin@role-grants-e2e-2.test';

/** What the seeded Admin starts with — deliberately short of the catalog. */
const ADMIN_GRANTS = ['setUsers', 'evCreate', 'regView', 'regManage'];
/**
 * A key in Admin's defaults that the seeded Admin has no row for at all, so it
 * is the key that says whether anything filled a gap on its own.
 */
const GAP_KEY = 'finManage';
/**
 * Two workspace ages, because the withdrawn backfill decided what to grant by
 * comparing a role's `created_at` against the date a key entered the catalog.
 * A rule that still fired for one age and not the other would pass a fixture
 * that left both workspaces at `now()`, so the ages are spelled out: one
 * workspace older than every key the backfill knew about, one younger.
 */
const PROVISIONED_BEFORE_THE_KEYS = '2026-07-29T13:01:36Z';
const PROVISIONED_AFTER_THE_KEYS = '2026-09-01T00:00:00Z';

interface Success<T> {
  data: T;
}
interface Role {
  id: number;
  name: string;
  permissions: string[];
  neverOfferedPermissions: string[];
}
interface GrantRow {
  id: number;
  key: string;
  granted: boolean;
}

describe('Role grant records (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let adminRoleId: number;
  let organizerRoleId: number;
  let customStaffRoleId: number;
  let youngAdminRoleId: number;
  let adminJwt: string;
  /** Every role's rows as seeded, read before anybody has signed in. */
  let beforeAnySignIn: Record<number, GrantRow[]>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seedCatalog(pool);

    const seeded = await seedOrg(
      pool,
      ORG,
      [
        {
          name: 'Admin',
          isSystem: true,
          grants: ADMIN_GRANTS,
          createdAt: PROVISIONED_BEFORE_THE_KEYS,
        },
        {
          name: 'Organizer',
          isSystem: true,
          grants: ['evCreate'],
          createdAt: PROVISIONED_BEFORE_THE_KEYS,
        },
        // A workspace's OWN role that happens to carry a built-in name: nothing
        // may treat it as a built-in because of the name on the tab.
        {
          name: 'Staff',
          isSystem: false,
          grants: ['regView'],
          createdAt: PROVISIONED_BEFORE_THE_KEYS,
        },
      ],
      [{ email: ADMIN, roleName: 'Admin' }],
    );
    adminRoleId = seeded.roleIdByName.Admin;
    organizerRoleId = seeded.roleIdByName.Organizer;
    customStaffRoleId = seeded.roleIdByName.Staff;

    // A workspace provisioned after those keys existed. The withdrawn backfill
    // treated the two ages differently, so both are here.
    const young = await seedOrg(
      pool,
      YOUNG_ORG,
      [
        {
          name: 'Admin',
          isSystem: true,
          grants: ADMIN_GRANTS,
          createdAt: PROVISIONED_AFTER_THE_KEYS,
        },
      ],
      [{ email: YOUNG_ADMIN, roleName: 'Admin' }],
    );
    youngAdminRoleId = young.roleIdByName.Admin;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    // Read the seeded rows BEFORE the first sign-in, because the sign-in is
    // what is under test: a JWT cannot be obtained without one, so the
    // comparison has to be taken first.
    beforeAnySignIn = await readAllGrants(pool, [
      adminRoleId,
      organizerRoleId,
      customStaffRoleId,
      youngAdminRoleId,
    ]);
    adminJwt = await login(server, ADMIN, ORG.slug);
    await login(server, YOUNG_ADMIN, YOUNG_ORG.slug);
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const grants = (roleId: number) => readGrants(pool, roleId);

  const setPermissions = (roleId: number, permissions: string[]) =>
    request(server)
      .put(`/api/v1/roles/${roleId}/permissions`)
      .set({ Authorization: `Bearer ${adminJwt}` })
      .send({ permissions });

  /**
   * THE property the withdrawal exists for. Two designs tried to grant the
   * missing keys at sign-in, and both of them silently reversed a decision an
   * organizer had made — the first because a workspace provisioned after a key
   * appeared was handed it at once, the second because a key granted and later
   * revoked leaves an old role with no row to tell it from a gap. Nothing on
   * disk records what a role was ever offered, so no rule over dates can
   * recover that intent. A sign-in therefore writes nothing at all.
   */
  describe('signing in', () => {
    it.each([
      ['older than every key the backfill knew about', () => adminRoleId],
      ['younger than all of them', () => youngAdminRoleId],
    ])('grants nothing to a built-in role of a workspace %s', async (_, of) => {
      const roleId = of();

      expect(await grants(roleId)).toEqual(beforeAnySignIn[roleId]);
    });

    it('leaves the gap it used to fill exactly as it found it', async () => {
      const keys = (await grants(adminRoleId)).map((g) => g.key);

      expect(keys).not.toContain(GAP_KEY);
      expect(keys.sort()).toEqual([...ADMIN_GRANTS].sort());
    });

    it('never touches a role the workspace made itself either', async () => {
      expect(await grants(customStaffRoleId)).toEqual(
        beforeAnySignIn[customStaffRoleId],
      );
    });
  });

  /**
   * The third state, which is what the editor must show: a key the role has no
   * row for has never been put to anybody here, and is not the same fact as a
   * key somebody turned off.
   */
  describe('reading a role', () => {
    it('reports a key with no row as never offered, not as refused', async () => {
      const role = await readRole(server, adminJwt, adminRoleId);

      expect(role.neverOfferedPermissions).toContain(GAP_KEY);
      expect(role.permissions).not.toContain(GAP_KEY);
    });

    it('does not report a key the role holds as never offered', async () => {
      const role = await readRole(server, adminJwt, adminRoleId);

      expect(role.neverOfferedPermissions).not.toContain('setUsers');
      expect(role.permissions).toContain('setUsers');
    });

    it('accounts for every catalog key exactly once', async () => {
      const role = await readRole(server, adminJwt, adminRoleId);

      // Granted and never-offered are disjoint, and what is left over is the
      // refusals — so a key cannot fall out of the contract unaccounted for.
      expect(
        [...role.permissions, ...role.neverOfferedPermissions].sort(),
      ).toEqual(PERMISSION_CATALOG.map((p) => p.key).sort());
    });
  });

  /**
   * A save is the organizer's decision about the WHOLE catalog, because the
   * editor draws a switch for every key in it. So it records a refusal for
   * every key it leaves off, including the keys the role had no row for: that
   * is what turns a never-offered key into a decided one, and without it the
   * editor would go on reporting a gap the organizer has already closed.
   */
  describe('saving a role', () => {
    beforeAll(async () => {
      // Organizer held evCreate; this save trades it for regView.
      await setPermissions(organizerRoleId, ['regView']).expect(200);
    });

    it('leaves a row saying a key it held is NOT granted, rather than no row', async () => {
      const row = (await grants(organizerRoleId)).find(
        (g) => g.key === 'evCreate',
      );

      expect(row).toBeDefined();
      expect(row?.granted).toBe(false);
    });

    it('records a refusal for a key the role had no row for at all', async () => {
      const row = (await grants(organizerRoleId)).find(
        (g) => g.key === GAP_KEY,
      );

      expect(row).toBeDefined();
      expect(row?.granted).toBe(false);
    });

    it('decides the whole catalog, leaving the role nothing unoffered', async () => {
      const role = await readRole(server, adminJwt, organizerRoleId);

      expect(role.neverOfferedPermissions).toEqual([]);
      expect(role.permissions).toEqual(['regView']);
    });

    it('grants exactly what was asked for and nothing else', async () => {
      const held = (await grants(organizerRoleId))
        .filter((g) => g.granted)
        .map((g) => g.key);

      expect(held).toEqual(['regView']);
    });

    it('reaches no further than the role it was asked about', async () => {
      expect(await grants(customStaffRoleId)).toEqual(
        beforeAnySignIn[customStaffRoleId],
      );
    });

    // Same ids, not merely the same keys: a save that deleted and re-inserted
    // would satisfy a key-level comparison while churning the table.
    it('changes nothing when the same set is saved again', async () => {
      const before = await grants(organizerRoleId);

      await setPermissions(organizerRoleId, ['regView']).expect(200);

      expect(await grants(organizerRoleId)).toEqual(before);
    });
  });

  // Stripping a role of everything is a legitimate save, and it is the one that
  // has nothing to say about the keys it is turning off — so the statement that
  // records them has no value to take its type from.
  describe('a role stripped of everything', () => {
    it('records the refusal of every catalog key, and grants none of them', async () => {
      await setPermissions(organizerRoleId, []).expect(200);
      const rows = await grants(organizerRoleId);

      expect(rows.map((g) => g.key).sort()).toEqual(
        PERMISSION_CATALOG.map((p) => p.key).sort(),
      );
      expect(rows.filter((g) => g.granted)).toEqual([]);
    });
  });
});

async function login(
  server: Server,
  email: string,
  orgSlug: string,
): Promise<string> {
  const res = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, orgSlug, persona: 'admin' });
  return (res.body as Success<{ accessToken: string }>).data.accessToken;
}

async function readRole(
  server: Server,
  jwt: string,
  roleId: number,
): Promise<Role> {
  const res = await request(server)
    .get('/api/v1/roles')
    .set({ Authorization: `Bearer ${jwt}` })
    .expect(200);
  const role = (res.body as Success<Role[]>).data.find((r) => r.id === roleId);
  if (!role) throw new Error(`Role ${roleId} missing from the roles list.`);
  return role;
}

/** Every row the role has, granted or not — the distinction under test. */
async function readGrants(pool: Pool, roleId: number): Promise<GrantRow[]> {
  const res = await pool.query<{
    id: string;
    permission_key: string;
    granted: boolean;
  }>(
    `SELECT id, permission_key, granted FROM role_permissions
      WHERE role_id = $1 ORDER BY permission_key`,
    [roleId],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    key: r.permission_key,
    granted: r.granted,
  }));
}

async function readAllGrants(
  pool: Pool,
  roleIds: number[],
): Promise<Record<number, GrantRow[]>> {
  const entries = await Promise.all(
    roleIds.map(async (id) => [id, await readGrants(pool, id)] as const),
  );
  return Object.fromEntries(entries);
}

/** The whole catalog, because a save records a decision about all of it. */
async function seedCatalog(pool: Pool): Promise<void> {
  for (const p of PERMISSION_CATALOG) {
    await pool.query(
      `INSERT INTO permissions (key, "group", label) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO NOTHING`,
      [p.key, p.group, p.label],
    );
  }
}

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  rolesSpec: {
    name: string;
    isSystem: boolean;
    grants: string[];
    createdAt: string;
  }[],
  usersSpec: { email: string; roleName: string }[],
): Promise<{ orgId: number; roleIdByName: Record<string, number> }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const orgId = Number(res.rows[0].id);

  const roleIdByName: Record<string, number> = {};
  for (const spec of rolesSpec) {
    // `created_at` is spelled out rather than left to `now()`: it is the column
    // the withdrawn backfill gated on, so a fixture that defaulted it would
    // describe only the younger of the two cases this spec needs.
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description, is_system, created_at)
       VALUES ($1, $2, 'seed', $3, $4) RETURNING id`,
      [orgId, spec.name, spec.isSystem, spec.createdAt],
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
  const slugs = [ORG.slug, YOUNG_ORG.slug];
  // audit_events is ON DELETE RESTRICT (a sign-in writes one), so clear it first.
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [slugs],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
