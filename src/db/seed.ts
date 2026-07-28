/**
 * Seed local dev data so you can exercise the API by hand (Swagger at /api/docs).
 *
 * Creates one tenant with an admin you can sign in as — these are the exact
 * example values shown in the Swagger `login` schema, so POST /auth/login →
 * "Try it out" → Execute works with no edits:
 *
 *   orgSlug   acme
 *   email     admin@acme.test
 *   password  correct horse battery staple
 *
 * Idempotent: re-running wipes and recreates the `acme` tenant (cascades to its
 * users/roles/memberships). Dev tooling — like drizzle.config.ts it reads
 * DATABASE_URL directly and never runs in the request path.
 *
 * Run: `pnpm seed` (needs `docker compose up -d` + `pnpm migrate` first).
 */
import { hash } from '@node-rs/argon2';
import { Pool } from 'pg';

const ORG = { name: 'Acme', slug: 'acme' } as const;
const ADMIN = {
  name: 'Acme Admin',
  email: 'admin@acme.test',
  password: 'correct horse battery staple',
} as const;
// The full permission catalog (permission_key enum). The seeded Admin role is
// granted all of them, so the admin account can create/publish events, etc.
const PERMISSIONS = [
  { key: 'evCreate', group: 'Events', label: 'Create & edit events' },
  { key: 'evPublish', group: 'Events', label: 'Publish & unpublish events' },
  { key: 'evSpeakers', group: 'Events', label: 'Manage speakers & program' },
  { key: 'regView', group: 'Registrations', label: 'View registrations' },
  { key: 'regCheckin', group: 'Registrations', label: 'Check in attendees' },
  { key: 'regExport', group: 'Registrations', label: 'Export registrations' },
  { key: 'finView', group: 'Finance', label: 'View finances' },
  { key: 'finRefund', group: 'Finance', label: 'Issue refunds' },
  { key: 'finDiscount', group: 'Finance', label: 'Manage discounts' },
  { key: 'setUsers', group: 'Settings', label: 'Manage team' },
  { key: 'setSettings', group: 'Settings', label: 'Manage settings' },
  { key: 'setIntegrations', group: 'Settings', label: 'Manage integrations' },
] as const;
// A few workspace categories so the event `categoryId` path is testable.
// (color values are the `category_color` enum; icon is a Hugeicons slug.)
const CATEGORIES = [
  { name: 'Conference', icon: 'presentation-01', color: 'blue' },
  { name: 'Workshop', icon: 'tools', color: 'amber' },
  { name: 'Concert', icon: 'music-note-01', color: 'violet' },
] as const;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error('DATABASE_URL is required (copy .env.example → .env)');
  return url;
}

async function resetTenant(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}

async function insertOrg(pool: Pool): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  return Number(res.rows[0].id);
}

async function insertPermissions(pool: Pool): Promise<void> {
  for (const p of PERMISSIONS) {
    await pool.query(
      `INSERT INTO permissions (key, "group", label) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO NOTHING`,
      [p.key, p.group, p.label],
    );
  }
}

async function insertAdminRole(pool: Pool, orgId: number): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description)
     VALUES ($1, 'Admin', 'Full access') RETURNING id`,
    [orgId],
  );
  const roleId = Number(res.rows[0].id);
  for (const p of PERMISSIONS) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
      [roleId, p.key],
    );
  }
  return roleId;
}

async function insertAdminUser(
  pool: Pool,
  orgId: number,
  roleId: number,
): Promise<void> {
  const passwordHash = await hash(ADMIN.password);
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1, $2, $3, 'admin', 'Active', $4) RETURNING id`,
    [orgId, ADMIN.name, ADMIN.email, passwordHash],
  );
  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
     VALUES ($1, $2, $3, 'Admin', 'Active')`,
    [orgId, res.rows[0].id, roleId],
  );
}

async function insertCategories(pool: Pool, orgId: number): Promise<void> {
  console.log('[seed] categories (use one as `categoryId` on POST /events):');
  for (const c of CATEGORIES) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO categories (organization_id, name, icon, color)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [orgId, c.name, c.icon, c.color],
    );
    console.log(`  ${c.name.padEnd(12)} id ${res.rows[0].id}`);
  }
}

function printCredentials(): void {
  console.log('[seed] ready — sign in at /api/docs → POST /auth/login:');
  console.log(`  orgSlug   ${ORG.slug}`);
  console.log(`  email     ${ADMIN.email}`);
  console.log(`  password  ${ADMIN.password}`);
}

async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    await resetTenant(pool);
    const orgId = await insertOrg(pool);
    await insertPermissions(pool);
    const roleId = await insertAdminRole(pool, orgId);
    await insertAdminUser(pool, orgId, roleId);
    await insertCategories(pool, orgId);
    printCredentials();
  } finally {
    await pool.end();
  }
}

void seed();
