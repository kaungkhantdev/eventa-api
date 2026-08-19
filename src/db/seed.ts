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
import {
  DEFAULT_ROLES,
  PERMISSION_CATALOG,
} from '../modules/access/workspace-defaults';
import { LANDING_TEMPLATES } from '../modules/events/landing-templates';

const ORG = { name: 'Acme', slug: 'acme' } as const;
const ADMIN = {
  name: 'Acme Admin',
  email: 'admin@acme.test',
  password: 'correct horse battery staple',
} as const;
const STAFF = {
  name: 'Acme Staff',
  email: 'staff@acme.test',
  password: 'correct horse battery staple',
} as const;
// The permission catalog and the default role matrix are the SAME ones a real
// workspace is provisioned with — imported, never re-typed, so a seeded tenant
// can never drift from what signup creates.
const PERMISSIONS = PERMISSION_CATALOG;
const ROLES = DEFAULT_ROLES;
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
  // audit_events is ON DELETE RESTRICT (audit records never cascade), so clear
  // them before dropping the org.
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
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

async function insertRoles(
  pool: Pool,
  orgId: number,
): Promise<Record<string, number>> {
  const idByName: Record<string, number> = {};
  for (const role of ROLES) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO roles (organization_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, role.name, role.description],
    );
    const roleId = Number(res.rows[0].id);
    idByName[role.name] = roleId;
    for (const key of role.grants) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_key, granted) VALUES ($1, $2, true)`,
        [roleId, key],
      );
    }
  }
  return idByName;
}

async function insertUser(
  pool: Pool,
  orgId: number,
  person: { name: string; email: string; password: string },
  roleId: number,
  roleName: string,
): Promise<void> {
  const passwordHash = await hash(person.password);
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1, $2, $3, 'admin', 'Active', $4) RETURNING id`,
    [orgId, person.name, person.email, passwordHash],
  );
  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
     VALUES ($1, $2, $3, $4, 'Active')`,
    [orgId, res.rows[0].id, roleId, roleName],
  );
}

// Global landing-template lookup (not tenant-scoped) — required before any event
// can pick a template on publish (FK events.landing_template_id → this table).
async function insertLandingTemplates(pool: Pool): Promise<void> {
  for (const t of LANDING_TEMPLATES) {
    await pool.query(
      `INSERT INTO landing_templates (id, title, badge, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, badge = EXCLUDED.badge,
             description = EXCLUDED.description`,
      [t.id, t.title, t.badge, t.description],
    );
  }
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
  console.log(
    '[seed] ready — sign in at /api/docs → POST /auth/login (orgSlug: ' +
      ORG.slug +
      '):',
  );
  console.log(`  Admin  ${ADMIN.email}  (all permissions)`);
  console.log(`  Staff  ${STAFF.email}  (regView, regCheckin only)`);
  console.log(`  password (both): ${ADMIN.password}`);
  console.log(
    '[seed] roles seeded: Admin, Organizer, Staff — edit via PUT /roles/:id/permissions',
  );
}

async function seed(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    await resetTenant(pool);
    const orgId = await insertOrg(pool);
    await insertPermissions(pool);
    const roleIds = await insertRoles(pool, orgId);
    await insertUser(pool, orgId, ADMIN, roleIds.Admin, 'Admin');
    await insertUser(pool, orgId, STAFF, roleIds.Staff, 'Staff');
    await insertLandingTemplates(pool);
    await insertCategories(pool, orgId);
    printCredentials();
  } finally {
    await pool.end();
  }
}

void seed();
