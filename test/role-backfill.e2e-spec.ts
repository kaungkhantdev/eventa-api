process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Pool, type PoolClient } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';
import { SystemRolesService } from '../src/modules/access/system-roles.service';
import { PERMISSION_CATALOG } from '../src/modules/access/workspace-defaults';
import { listenOnLoopback } from './support/loopback';

/**
 * Built-in roles are handed their grants once, the day the workspace is made, so
 * every permission key added to the catalog afterwards is missing from every
 * workspace older than it. Filling that gap is only safe if "this role does not
 * grant the key" and "the organizer took the key away" are different facts on
 * disk — which, until now, they were not: a revoke deleted the row.
 *
 * These assertions are about SQL (an upsert, an ON CONFLICT, an RLS-scoped
 * statement), so they are here against the real database rather than in a unit
 * spec, where a mocked driver would only prove the mock agrees with itself.
 */
const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'role-backfill-e2e', name: 'Role Backfill E2E' };
const ORG2 = { slug: 'role-backfill-e2e-2', name: 'Role Backfill E2E 2' };
const ADMIN = 'admin@role-backfill-e2e.test';
/** The non-owning role the app connects as in staging/prod, as in rls.e2e-spec. */
const APP_ROLE = 'eventa_app';

/** What the seeded Admin starts with — deliberately short of the catalog. */
const ADMIN_GRANTS = ['setUsers', 'evCreate', 'regView', 'regManage'];
/**
 * A key the seeded Admin has no row for at all, postdating the built-in roles
 * so the reconcile may fill it — and in ADMIN's defaults alone, so the same key
 * says whether the reconcile kept to the role it was filling.
 */
const GAP_KEY = 'finManage';
/**
 * Also in Admin's defaults, also with no row — but it predates the built-in
 * roles, so its absence is what a revoke looked like before a removal was
 * recorded. Indistinguishable from a gap, and therefore not the reconcile's to
 * fill.
 */
const OLD_REVOKE_KEY = 'finRefund';

interface Success<T> {
  data: T;
}
interface Role {
  id: number;
  name: string;
  permissions: string[];
}
interface GrantRow {
  id: number;
  key: string;
  granted: boolean;
}

describe('Built-in role backfill (e2e — reconcile & recorded removals)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let systemRoles: SystemRolesService;
  let orgId: number;
  let adminRoleId: number;
  let organizerRoleId: number;
  let customStaffRoleId: number;
  let otherAdminRoleId: number;
  let adminJwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await ensureAppRole(pool);
    await seedCatalog(pool);

    const seeded = await seedOrg(
      pool,
      ORG,
      [
        { name: 'Admin', isSystem: true, grants: ADMIN_GRANTS },
        { name: 'Organizer', isSystem: true, grants: ['evCreate'] },
        // A workspace's OWN role that happens to carry a built-in name. The
        // reconcile must go by is_system, not by the name on the tab.
        { name: 'Staff', isSystem: false, grants: ['regView'] },
      ],
      [{ email: ADMIN, roleName: 'Admin' }],
    );
    orgId = seeded.orgId;
    adminRoleId = seeded.roleIdByName.Admin;
    organizerRoleId = seeded.roleIdByName.Organizer;
    customStaffRoleId = seeded.roleIdByName.Staff;

    // A second workspace carrying the SAME gap, so "it filled the gap" and "it
    // filled every gap it could reach" cannot both pass.
    const other = await seedOrg(
      pool,
      ORG2,
      [{ name: 'Admin', isSystem: true, grants: ADMIN_GRANTS }],
      [],
    );
    otherAdminRoleId = other.roleIdByName.Admin;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;
    systemRoles = app.get(SystemRolesService);
    adminJwt = await login(server, ADMIN, ORG.slug);
    await restoreSeededGaps(pool, organizerRoleId, ['evCreate']);
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

  describe('saving a role records what was turned off', () => {
    beforeAll(async () => {
      // Organizer held evCreate; this save trades it for regView.
      await setPermissions(organizerRoleId, ['regView']).expect(200);
    });

    it('leaves a row saying the key is NOT granted, rather than no row at all', async () => {
      const row = (await grants(organizerRoleId)).find(
        (g) => g.key === 'evCreate',
      );

      expect(row).toBeDefined();
      expect(row?.granted).toBe(false);
    });

    // Only keys the role was OFFERED. The editor draws a switch off for a key
    // this workspace was never given as readily as for one the organizer took
    // away, so a save cannot be read as a refusal of the first: writing a row
    // for it would record a decision nobody made, and — because the backfill
    // never overwrites a row — seal the gap the backfill exists to close.
    it('leaves a key the role has no row for alone, rather than inventing a refusal', async () => {
      const rows = await grants(organizerRoleId);

      expect(rows.map((g) => g.key).sort()).toEqual(['evCreate', 'regView']);
      expect(rows.filter((g) => g.granted).map((g) => g.key)).toEqual([
        'regView',
      ]);
    });

    it('does not report the role as holding what was turned off', async () => {
      const role = await readRole(server, adminJwt, organizerRoleId);

      expect(role.permissions).toEqual(['regView']);
    });
  });

  describe('the reconcile', () => {
    let otherOrgBefore: GrantRow[];

    beforeAll(async () => {
      otherOrgBefore = await readGrants(pool, otherAdminRoleId);
      await systemRoles.reconcile(orgId);
    });

    // THE property the whole design exists for.
    it('does not re-grant a key the organizer turned off', async () => {
      const row = (await grants(organizerRoleId)).find(
        (g) => g.key === 'evCreate',
      );

      expect(row?.granted).toBe(false);
    });

    it('grants a built-in role a key it has no row for at all', async () => {
      const row = (await grants(adminRoleId)).find((g) => g.key === GAP_KEY);

      expect(row?.granted).toBe(true);
    });

    // A save is not a refusal of a key the role was never offered, so saving a
    // role must not cost it the backfill. Organizer was saved above, and its
    // two owed keys are still owed.
    it('still fills the gaps of a role that has been saved since', async () => {
      const held = (await grants(organizerRoleId))
        .filter((g) => g.granted)
        .map((g) => g.key);

      expect(held.sort()).toEqual(['evProgramView', 'regManage', 'regView']);
    });

    // Per role, not "the missing keys everywhere": `finManage` is in Admin's
    // defaults alone, so an Organizer that came out of this able to void an
    // invoice would be an escalation the reconcile invented.
    it('fills a role from its own defaults, not from every role’s', async () => {
      const rows = await grants(organizerRoleId);

      expect(rows.map((g) => g.key)).not.toContain(GAP_KEY);
    });

    // The reconcile cannot tell a key an organizer removed from one that was
    // never offered, for every key older than recorded removals — so it is
    // restricted to the keys that postdate the roles and leaves the rest.
    it('does not put back a key old enough to have been revoked before removals were recorded', async () => {
      const rows = await grants(adminRoleId);

      expect(rows.map((g) => g.key)).not.toContain(OLD_REVOKE_KEY);
    });

    // An exact set, not a superset: `arrayContaining` is satisfied by a
    // reconcile that handed the role everything, which is the failure mode.
    it('leaves the grants the role already held exactly as they were', async () => {
      const held = (await grants(adminRoleId))
        .filter((g) => g.granted)
        .map((g) => g.key);

      expect(held.sort()).toEqual(
        [...ADMIN_GRANTS, GAP_KEY, 'evProgramView'].sort(),
      );
    });

    it('never touches a role the workspace made itself, whatever it is called', async () => {
      const rows = await grants(customStaffRoleId);

      expect(rows).toEqual([
        expect.objectContaining({ key: 'regView', granted: true }),
      ]);
    });

    it('reaches no further than the workspace it was asked about', async () => {
      expect(await readGrants(pool, otherAdminRoleId)).toEqual(otherOrgBefore);
    });

    // Same ids, not merely the same keys: a reconcile that deleted and
    // re-inserted would satisfy a key-level comparison while churning the table
    // on every sign-in.
    it('changes nothing the second time it runs', async () => {
      const before = await readGrants(pool, adminRoleId);

      await systemRoles.reconcile(orgId);

      expect(await readGrants(pool, adminRoleId)).toEqual(before);
    });
  });

  // Stripping a role of everything is a legitimate save, and it is the one that
  // has nothing to say about the keys it is turning off — so the statement that
  // records them has no value to take its type from.
  describe('a role stripped of everything', () => {
    it('records the refusal of every key it held, and grants none of them', async () => {
      const before = (await grants(organizerRoleId)).map((g) => g.key).sort();

      await setPermissions(organizerRoleId, []).expect(200);
      const rows = await grants(organizerRoleId);

      expect(rows.map((g) => g.key).sort()).toEqual(before);
      expect(rows.filter((g) => g.granted)).toEqual([]);
    });
  });

  /**
   * The same backfill for the workspaces that already exist, which the
   * reconcile cannot reach until somebody signs in.
   *
   * Its one dangerous property is that it READS an RLS-protected table:
   * `roles`. Under the role the app connects as, the tenant policy matches
   * nothing with no `app.current_org` set, so the statement would insert zero
   * rows, commit, and be stamped as applied — a backfill that silently did
   * nothing at all. `SET LOCAL row_security = off` is what turns that into a
   * refusal; for the owning role migrations are meant to run as, it is a no-op.
   */
  describe('the one-off migration', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../src/db/migrations/0067_backfill_system_role_grants.sql',
      ),
      'utf8',
    ).replace(/--> statement-breakpoint/g, '');

    it('fills the gap for a workspace no reconcile has reached', async () => {
      const held = await inRolledBackTransaction(pool, async (client) => {
        await client.query(sql);
        return client.query<{ permission_key: string }>(
          `SELECT permission_key FROM role_permissions
            WHERE role_id = $1 AND granted`,
          [otherAdminRoleId],
        );
      });

      expect(held.rows.map((r) => r.permission_key).sort()).toEqual(
        [...ADMIN_GRANTS, GAP_KEY, 'evProgramView'].sort(),
      );
    });

    it('refuses to run as the role the app connects as, rather than backfilling nothing', async () => {
      await expect(
        inRolledBackTransaction(pool, async (client) => {
          await client.query(`SET ROLE ${APP_ROLE}`);
          return client.query(sql);
        }),
      ).rejects.toThrow(/row-level security/i);
    });
  });
});

/**
 * Run against the real database and undo it.
 *
 * The migration carries no organization predicate — it is meant to reach every
 * tenant on disk — so it cannot be left applied by a test run.
 */
async function inRolledBackTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** The non-owning role RLS actually applies to, created the way rls.e2e-spec does. */
async function ensureAppRole(pool: Pool): Promise<void> {
  await pool.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${APP_ROLE}')
     THEN CREATE ROLE ${APP_ROLE} NOLOGIN; END IF; END $$;`,
  );
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
  );
  await pool.query(
    `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
  );
}

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

/**
 * Put a seeded role back to the gap it was seeded with, after signing in.
 *
 * Signing in reconciles this workspace (AuthService.startSession), which is the
 * whole point of the feature but also means the fixture cannot hand a built-in
 * role a gap and then reach it through the API: the login that mints the JWT
 * has already filled it. The scenarios below need the gap to still be open at
 * the moment the role is SAVED, so this reopens it — deleting the rows the
 * sign-in added rather than the seeded ones, which is the difference between a
 * key with no row (a gap) and a key the organizer turned off (a tombstone).
 */
async function restoreSeededGaps(
  pool: Pool,
  roleId: number,
  seeded: string[],
): Promise<void> {
  await pool.query(
    `DELETE FROM role_permissions
      WHERE role_id = $1 AND permission_key <> ALL($2::permission_key[])`,
    [roleId, seeded],
  );
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

/** The whole catalog, because a save now records a decision about all of it. */
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
  rolesSpec: { name: string; isSystem: boolean; grants: string[] }[],
  usersSpec: { email: string; roleName: string }[],
): Promise<{ orgId: number; roleIdByName: Record<string, number> }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const orgId = Number(res.rows[0].id);

  const roleIdByName: Record<string, number> = {};
  for (const spec of rolesSpec) {
    const role = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description, is_system)
       VALUES ($1, $2, 'seed', $3) RETURNING id`,
      [orgId, spec.name, spec.isSystem],
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
  // audit_events is ON DELETE RESTRICT (a sign-in writes one), so clear it first.
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [slugs],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
