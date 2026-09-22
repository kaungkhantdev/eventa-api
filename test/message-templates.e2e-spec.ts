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
import { MESSAGE_TEMPLATE_CATALOG } from '../src/modules/message-templates/message-template-catalog';
import { listenOnLoopback } from './support/loopback';

/**
 * The automated-message switch against a real database (US-MSG-01).
 *
 * The unit tests prove the rules against a fake repository. What they cannot
 * prove is the thing the whole feature rests on: that switching a message off
 * lands in `message_templates` and is still off when read back — because that
 * row is what eventa-worker checks before it sends. A switch that does not
 * survive the round trip is a switch that lies.
 */

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'tpl-e2e', name: 'Templates E2E' };
const ORG2 = { slug: 'tpl-e2e-2', name: 'Templates E2E 2' };
const ADMIN = 'admin@tpl-e2e.test';
const STAFF = 'staff@tpl-e2e.test';
const ADMIN2 = 'admin@tpl-e2e-2.test';

const PERM_GROUP: Record<string, string> = {
  setSettings: 'Settings',
  regView: 'Registrations',
};

const CONFIRMATION = 'registration-confirmation';
/** Off until a workspace switches it on — every other message starts on. */
const REMINDER = 'event-reminder';

interface Success<T> {
  data: T;
}
interface Template {
  slug: string;
  tags: string[];
  wording: {
    subjectEn: string | null;
    bodyEn: string | null;
    subjectTh: string | null;
    bodyTh: string | null;
  };
  title: string;
  description: string;
  channels: string[];
  delivery: 'controlled' | 'always' | 'planned';
  expected: boolean;
  active: boolean;
}

describe('Message templates (e2e — US-MSG-01)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let otherOrgId: number;
  let adminJwt: string;
  let staffJwt: string;
  let otherJwt: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, [
      { email: ADMIN, roleName: 'Admin', grants: ['setSettings'] },
      { email: STAFF, roleName: 'Staff', grants: ['regView'] },
    ]);
    otherOrgId = await seedOrg(pool, ORG2, [
      { email: ADMIN2, roleName: 'Admin', grants: ['setSettings'] },
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;

    adminJwt = await token(ADMIN, ORG.slug);
    staffJwt = await token(STAFF, ORG.slug);
    otherJwt = await token(ADMIN2, ORG2.slug);
  }, 30000);

  afterEach(async () => {
    await pool.query(
      `DELETE FROM message_templates WHERE organization_id = ANY($1)`,
      [[orgId, otherOrgId]],
    );
  });

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  async function token(email: string, orgSlug: string): Promise<string> {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, orgSlug, persona: 'admin' });
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  }

  const list = (jwt: string) =>
    request(server)
      .get('/api/v1/message-templates')
      .set('Authorization', `Bearer ${jwt}`);

  const setActive = (jwt: string, slug: string, body: object) =>
    request(server)
      .patch(`/api/v1/message-templates/${slug}`)
      .set('Authorization', `Bearer ${jwt}`)
      .send(body);

  /** The switch as eventa-worker will read it. */
  const storedActive = async (org: number, slug: string): Promise<boolean> => {
    const row = await pool.query<{ active: boolean }>(
      `SELECT active FROM message_templates WHERE organization_id = $1 AND slug = $2`,
      [org, slug],
    );
    return row.rows[0].active;
  };

  const find = (body: unknown, slug: string): Template => {
    const items = (body as Success<Template[]>).data;
    const found = items.find((t) => t.slug === slug);
    if (!found) throw new Error(`No template ${slug} in the response`);
    return found;
  };

  describe('reading the list', () => {
    it('answers with every message at its default before anything is stored', async () => {
      const res = await list(adminJwt).expect(200);
      const items = (res.body as Success<Template[]>).data;
      expect(items.map((t) => [t.slug, t.active])).toEqual(
        MESSAGE_TEMPLATE_CATALOG.map((d) => [d.slug, d.defaultActive]),
      );
      // Spelled out, because it is the one a workspace has to choose.
      expect(find(res.body, REMINDER).active).toBe(false);
    });

    it('refuses a member without the settings permission', async () => {
      await list(staffJwt).expect(403);
    });
  });

  describe('switching a message off', () => {
    it('survives the round trip, which is what the worker will read', async () => {
      const patched = await setActive(adminJwt, CONFIRMATION, {
        active: false,
      }).expect(200);
      expect(find(patched.body, CONFIRMATION).active).toBe(false);

      const reread = await list(adminJwt).expect(200);
      expect(find(reread.body, CONFIRMATION).active).toBe(false);

      const row = await pool.query<{ active: boolean }>(
        `SELECT active FROM message_templates WHERE organization_id = $1 AND slug = $2`,
        [orgId, CONFIRMATION],
      );
      expect(row.rows[0].active).toBe(false);
    });

    it('writes the cancellation notice’s row that eventa-worker reads', async () => {
      // Two handlers check this table now, keyed on (organization, slug).
      await setActive(adminJwt, 'cancellation-notice', {
        active: false,
      }).expect(200);

      const rows = await pool.query<{ slug: string; active: boolean }>(
        `SELECT slug, active FROM message_templates WHERE organization_id = $1`,
        [orgId],
      );
      expect(rows.rows).toEqual([
        { slug: 'cancellation-notice', active: false },
      ]);
    });

    it('switches back on without stacking a second row', async () => {
      await setActive(adminJwt, CONFIRMATION, { active: false }).expect(200);
      const back = await setActive(adminJwt, CONFIRMATION, {
        active: true,
      }).expect(200);
      expect(find(back.body, CONFIRMATION).active).toBe(true);

      const rows = await pool.query(
        `SELECT 1 FROM message_templates WHERE organization_id = $1 AND slug = $2`,
        [orgId, CONFIRMATION],
      );
      expect(rows.rowCount).toBe(1);
    });

    it('switches the reminder on, and the row the worker reads says so', async () => {
      const patched = await setActive(adminJwt, REMINDER, {
        active: true,
      }).expect(200);
      expect(find(patched.body, REMINDER).active).toBe(true);
      expect(await storedActive(orgId, REMINDER)).toBe(true);
    });

    it('leaves another workspace’s messages alone', async () => {
      await setActive(adminJwt, CONFIRMATION, { active: false }).expect(200);
      const theirs = await list(otherJwt).expect(200);
      expect(find(theirs.body, CONFIRMATION).active).toBe(true);
    });
  });

  describe('the organizer’s own wording (US-MSG-02)', () => {
    const wording = (jwt: string, slug: string, body: object) =>
      request(server)
        .patch(`/api/v1/message-templates/${slug}/wording`)
        .set('Authorization', `Bearer ${jwt}`)
        .send(body);

    const EN = {
      subject: 'You’re in, {{first_name}}',
      body: 'See you at {{event_name}}.',
    };
    const BLANK = { subject: '', body: '' };

    it('saves it, and answers with it', async () => {
      const res = await wording(adminJwt, CONFIRMATION, {
        en: EN,
        th: BLANK,
      }).expect(200);

      expect(find(res.body, CONFIRMATION).wording).toEqual({
        subjectEn: 'You’re in, {{first_name}}',
        bodyEn: 'See you at {{event_name}}.',
        subjectTh: null,
        bodyTh: null,
      });
      expect(find(res.body, CONFIRMATION).active).toBe(true);
    });

    const REMINDER_EN = {
      subject: 'See you tomorrow, {{first_name}}',
      body: '{{event_name}} starts soon.',
    };

    it('rewording the reminder does not switch it on', async () => {
      // The first save creates the row. Were it to take the column's default
      // (on), preparing the wording would quietly start mailing attendees.
      const res = await wording(adminJwt, REMINDER, {
        en: REMINDER_EN,
        th: BLANK,
      }).expect(200);

      expect(find(res.body, REMINDER).active).toBe(false);
      expect(await storedActive(orgId, REMINDER)).toBe(false);
    });

    it('rewording keeps a reminder that was switched on, on', async () => {
      // A later save must not touch the switch either way.
      await setActive(adminJwt, REMINDER, { active: true }).expect(200);
      const res = await wording(adminJwt, REMINDER, {
        en: REMINDER_EN,
        th: BLANK,
      }).expect(200);

      expect(find(res.body, REMINDER).active).toBe(true);
      expect(await storedActive(orgId, REMINDER)).toBe(true);
    });

    it('stores an emptied field as NULL, so the worker falls back', async () => {
      // An empty string would send a message with no subject rather than
      // Eventa's own copy.
      await wording(adminJwt, CONFIRMATION, { en: EN, th: BLANK }).expect(200);
      await wording(adminJwt, CONFIRMATION, { en: BLANK, th: BLANK }).expect(
        200,
      );

      const row = await pool.query<{ email_subject_en: string | null }>(
        `SELECT email_subject_en FROM message_templates
         WHERE organization_id = $1 AND slug = $2`,
        [orgId, CONFIRMATION],
      );
      expect(row.rows[0].email_subject_en).toBeNull();
    });

    it('refuses a half-written language, and says which', async () => {
      const res = await wording(adminJwt, CONFIRMATION, {
        en: { subject: 'Hello', body: '' },
        th: BLANK,
      }).expect(422);
      expect(JSON.stringify(res.body)).toMatch(/English/);
    });

    it('refuses a merge field this message cannot fill', async () => {
      const res = await wording(adminJwt, CONFIRMATION, {
        en: { subject: 'Hi', body: 'See you at {{venue}}' },
        th: BLANK,
      }).expect(422);
      expect(JSON.stringify(res.body)).toMatch(/venue/);
    });

    it('offers the fields each message can actually fill', async () => {
      const res = await list(adminJwt).expect(200);
      expect(find(res.body, CONFIRMATION).tags).toEqual([
        '{{first_name}}',
        '{{event_name}}',
      ]);
      expect(find(res.body, 'payment-receipt').tags).toEqual([
        '{{first_name}}',
        '{{event_name}}',
      ]);
      expect(find(res.body, 'waitlist-offer').tags).toEqual([
        '{{first_name}}',
        '{{event_name}}',
        '{{ticket_type}}',
      ]);
    });

    it('refuses a member without the settings permission', async () => {
      await wording(staffJwt, CONFIRMATION, { en: EN, th: BLANK }).expect(403);
    });
  });

  describe('switches that would change nothing', () => {
    it('404s a slug that is not a message at all', async () => {
      await setActive(adminJwt, 'not-a-message', { active: false }).expect(404);
    });

    it('400s a body with no decision in it', async () => {
      // Shape failure, not a domain rule: there is no "toggle", because a
      // request that flips an unknown state cannot be retried safely.
      await setActive(adminJwt, CONFIRMATION, {}).expect(400);
    });

    it('refuses a member without the settings permission', async () => {
      await setActive(staffJwt, CONFIRMATION, { active: false }).expect(403);
    });
  });
});

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  people: { email: string; roleName: string; grants: string[] }[],
): Promise<number> {
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
       VALUES ($1, 'Anan Suksawat', $2, 'admin', 'Active', $3) RETURNING id`,
      [orgId, p.email, passwordHash],
    );
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
       VALUES ($1, $2, $3, $4, 'Active')`,
      [orgId, user.rows[0].id, roleId, p.roleName],
    );
  }
  return orgId;
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  // Members, roles and grants cascade from the organization.
  for (const table of ['audit_events', 'outbox_events', 'message_templates']) {
    await pool.query(
      `DELETE FROM ${table} WHERE organization_id IN
         (SELECT id FROM organizations WHERE slug = ANY($1))`,
      [slugs],
    );
  }
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
