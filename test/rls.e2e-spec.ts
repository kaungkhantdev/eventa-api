// Proves Postgres RLS tenant isolation (ADR-5, SAD §13 "cross-tenant denial tests").
// Runs against the docker-compose DB with migrations applied. The owning role
// (DATABASE_URL) bypasses RLS, so the enforced assertions run under a dedicated
// non-superuser role via SET ROLE — the way the app connects in staging/prod.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';

import { Pool, type PoolClient } from 'pg';

const APP_ROLE = 'eventa_app';
const SLUGS = ['org-one-rls-test', 'org-two-rls-test'];

describe('RLS tenant isolation (integration)', () => {
  let pool: Pool;
  let org1: number;
  let org2: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // A non-superuser, non-owning role that RLS actually applies to.
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

    // Seed two tenants (as owner → RLS bypassed).
    await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [SLUGS]);
    const a = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('Org One', $1) RETURNING id`,
      [SLUGS[0]],
    );
    const b = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('Org Two', $1) RETURNING id`,
      [SLUGS[1]],
    );
    org1 = Number(a.rows[0].id);
    org2 = Number(b.rows[0].id);
    await pool.query(
      `INSERT INTO users (organization_id, name, email) VALUES ($1, 'Alice', 'alice@rls.test')`,
      [org1],
    );
    await pool.query(
      `INSERT INTO users (organization_id, name, email) VALUES ($1, 'Bob', 'bob@rls.test')`,
      [org2],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [SLUGS]);
    await pool.end();
  });

  async function asAppRole(
    fn: (c: PoolClient) => Promise<void>,
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${APP_ROLE}`);
      await fn(client);
    } finally {
      await client.query('RESET ROLE');
      await client.query('DISCARD ALL');
      client.release();
    }
  }

  const setOrg = (c: PoolClient, id: number) =>
    c.query(`SELECT set_config('app.current_org', $1, false)`, [String(id)]);
  const countUsers = async (c: PoolClient) =>
    (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`))
      .rows[0].n;

  it('denies all rows when no tenant is set (default deny)', async () => {
    await asAppRole(async (c) => {
      expect(await countUsers(c)).toBe(0);
    });
  });

  it('scopes reads to the current tenant', async () => {
    await asAppRole(async (c) => {
      await setOrg(c, org1);
      const r1 = await c.query<{ organization_id: string }>(
        `SELECT organization_id FROM users`,
      );
      expect(r1.rows).toHaveLength(1);
      expect(Number(r1.rows[0].organization_id)).toBe(org1);

      await setOrg(c, org2);
      const r2 = await c.query<{ organization_id: string }>(
        `SELECT organization_id FROM users`,
      );
      expect(r2.rows).toHaveLength(1);
      expect(Number(r2.rows[0].organization_id)).toBe(org2);
    });
  });

  it('blocks writing a row for another tenant (WITH CHECK)', async () => {
    await asAppRole(async (c) => {
      await setOrg(c, org1);
      await expect(
        c.query(
          `INSERT INTO users (organization_id, name, email) VALUES ($1, 'Mallory', 'mallory@rls.test')`,
          [org2],
        ),
      ).rejects.toThrow();
    });
  });
});
