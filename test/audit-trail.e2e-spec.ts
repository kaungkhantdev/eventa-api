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
import {
  CONTACT_AUDIT_TITLE,
  CONTACT_AUDIT_TYPE,
  contactAuditMeta,
} from '../src/modules/attendee-directory/attendee-contact.audit';
import { listenOnLoopback } from './support/loopback';

const PASSWORD = 'correct horse battery staple';
const ORG = { slug: 'audit-trail-e2e', name: 'Audit Trail E2E' };
const ORG2 = { slug: 'audit-trail-e2e-2', name: 'Audit Trail E2E 2' };

/** Holds `setUsers`, so the workspace-wide trail is theirs to read. */
const ADMIN = 'admin@audit-trail-e2e.test';
/** Holds `regManage` but NOT `setUsers` — pinned to their own entries. */
const ORGANIZER = 'organizer@audit-trail-e2e.test';
const OUTSIDER = 'admin@audit-trail-e2e-2.test';

const ANAN = { name: 'Anan Suksawat', email: 'anan@audit-trail.test' };
const MALEE = { name: 'Malee Chai', email: 'malee@audit-trail.test' };

const NEW_PHONE = '+66891112222';
const OTHER_PHONE = '+66895556666';

interface Entry {
  id: number;
  type: string;
  title: string;
  meta: string | null;
  actorName: string | null;
  occurredAt: string;
}
interface Page {
  data: Entry[];
  meta: { total: number; page: number; limit: number };
}
interface Failure {
  statusCode: number;
  errors?: { field: string; message: string }[];
}

/**
 * Reading one attendee's audit trail back (e2e — US-REG-08 AC5).
 *
 * The entry is written by the contact edit; this proves it can be *found*. The
 * match is a `meta` prefix, so the two tests that matter most are the one that
 * keeps `attendee #<id>` from matching a longer id, and the one that shows the
 * filter narrowing — never widening — what the caller could already list.
 */
describe('An attendee’s audit trail (e2e — US-REG-08 AC5)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let adminJwt: string;
  let organizerJwt: string;
  let outsiderJwt: string;
  let ananId: number;
  let maleeId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    orgId = await seedOrg(pool, ORG, ADMIN, [
      'setUsers',
      'regView',
      'regManage',
    ]);
    await seedMember(pool, orgId, ORGANIZER, 'Organizer', [
      'regView',
      'regManage',
    ]);
    await seedOrg(pool, ORG2, OUTSIDER, ['setUsers', 'regView', 'regManage']);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;
    adminJwt = await token(ADMIN, ORG.slug);
    organizerJwt = await token(ORGANIZER, ORG.slug);
    outsiderJwt = await token(OUTSIDER, ORG2.slug);
  }, 30000);

  beforeEach(async () => {
    await scopedDelete(
      pool,
      [ORG.slug, ORG2.slug],
      ['audit_events', 'attendees'],
    );
    ananId = await insertAttendee(orgId, ANAN);
    maleeId = await insertAttendee(orgId, MALEE);
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
    return (res.body as { data: { accessToken: string } }).data.accessToken;
  }

  const editPhone = (id: number, phone: string, bearer = adminJwt) =>
    request(server)
      .patch(`/api/v1/attendees/${id}`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ phone });

  const audit = (query: string, bearer = adminJwt) =>
    request(server)
      .get(`/api/v1/audit${query}`)
      .set('Authorization', `Bearer ${bearer}`);

  const page = (res: { body: unknown }) => res.body as Page;

  async function insertAttendee(
    org: number,
    person: { name: string; email: string },
  ): Promise<number> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO attendees (organization_id, name, email) VALUES ($1,$2,$3)
       RETURNING id`,
      [org, person.name, person.email],
    );
    return Number(res.rows[0].id);
  }

  /** A raw entry, for the rows a contact edit cannot produce on demand. */
  async function insertEntry(
    org: number,
    meta: string,
    actorEmail: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO audit_events (organization_id, type, title, meta, actor_user_id)
       VALUES ($1,$2,$3,$4,(SELECT id FROM users WHERE email = $5))`,
      [org, CONTACT_AUDIT_TYPE, CONTACT_AUDIT_TITLE, meta, actorEmail],
    );
  }

  describe('reopening the profile', () => {
    it('finds the “Updated contact details” entry for that attendee', async () => {
      expect((await editPhone(ananId, NEW_PHONE)).status).toBe(200);

      const res = await audit(
        `?subjectType=attendee&subjectId=${ananId}`,
      ).expect(200);
      expect(page(res).data).toHaveLength(1);
      expect(page(res).data[0]).toMatchObject({
        type: CONTACT_AUDIT_TYPE,
        title: CONTACT_AUDIT_TITLE,
        meta: contactAuditMeta(ananId, ['phone']),
      });
    });

    it('paginates like the unfiltered list', async () => {
      await editPhone(ananId, NEW_PHONE);
      await editPhone(ananId, OTHER_PHONE);

      const res = await audit(
        `?subjectType=attendee&subjectId=${ananId}&limit=1&page=2`,
      ).expect(200);
      expect(page(res).meta).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect(page(res).data).toHaveLength(1);
    });

    it('leaves out the entries about everybody else', async () => {
      await editPhone(ananId, NEW_PHONE);
      await editPhone(maleeId, OTHER_PHONE);

      const res = await audit(`?subjectType=attendee&subjectId=${maleeId}`);
      expect(page(res).data.map((e) => e.meta)).toEqual([
        contactAuditMeta(maleeId, ['phone']),
      ]);
    });
  });

  describe('the prefix is the whole mechanism', () => {
    it('does not match an attendee whose id merely starts the same', async () => {
      await editPhone(ananId, NEW_PHONE);
      const longer = Number(`${ananId}9`);
      await insertEntry(orgId, contactAuditMeta(longer, ['name']), ADMIN);

      const res = await audit(`?subjectType=attendee&subjectId=${ananId}`);
      expect(page(res).data.map((e) => e.meta)).toEqual([
        contactAuditMeta(ananId, ['phone']),
      ]);
    });

    it('does not match an entry of another type carrying the same text', async () => {
      await pool.query(
        `INSERT INTO audit_events (organization_id, type, title, meta)
         VALUES ($1,'perm','Changed role',$2)`,
        [orgId, contactAuditMeta(ananId, ['name'])],
      );

      const res = await audit(`?subjectType=attendee&subjectId=${ananId}`);
      expect(page(res).data).toHaveLength(0);
    });
  });

  describe('what the filter may not become', () => {
    it('cannot reach another workspace’s trail', async () => {
      await editPhone(ananId, NEW_PHONE);

      const res = await audit(
        `?subjectType=attendee&subjectId=${ananId}`,
        outsiderJwt,
      ).expect(200);
      expect(page(res).data).toHaveLength(0);
    });

    it('cannot widen a non-Admin past their own entries', async () => {
      // The Admin corrected Anan; the Organizer corrected Malee.
      await editPhone(ananId, NEW_PHONE);
      await editPhone(maleeId, OTHER_PHONE, organizerJwt);

      const theirs = await audit(
        `?subjectType=attendee&subjectId=${maleeId}`,
        organizerJwt,
      ).expect(200);
      expect(page(theirs).data).toHaveLength(1);

      const somebodyElses = await audit(
        `?subjectType=attendee&subjectId=${ananId}`,
        organizerJwt,
      ).expect(200);
      expect(page(somebodyElses).data).toHaveLength(0);
    });

    it('refuses half a subject rather than answering with the workspace', async () => {
      await editPhone(ananId, NEW_PHONE);
      await editPhone(maleeId, OTHER_PHONE);

      const res = await audit(`?subjectId=${ananId}`).expect(400);
      const body = res.body as Failure;
      expect(body.errors?.map((e) => e.field)).toContain('subjectType');
    });

    it('refuses a parameter it does not know', async () => {
      await audit(`?attendeeId=${ananId}`).expect(400);
    });
  });

  describe('the act filter', () => {
    it('narrows to one kind of act', async () => {
      await editPhone(ananId, NEW_PHONE);

      await audit(`?type=${CONTACT_AUDIT_TYPE}`)
        .expect(200)
        .expect((res) => expect(page(res).data).toHaveLength(1));
      await audit('?type=perm')
        .expect(200)
        .expect((res) => expect(page(res).data).toHaveLength(0));
    });

    it('refuses a label the schema enum does not define', async () => {
      await audit('?type=attendees').expect(400);
    });
  });

  describe('the export carries the same filters', () => {
    it('exports only the entries about one attendee', async () => {
      await editPhone(ananId, NEW_PHONE);
      await editPhone(maleeId, OTHER_PHONE);

      const res = await request(server)
        .get(`/api/v1/audit/export?subjectType=attendee&subjectId=${ananId}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .expect(200);
      const lines = res.text.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(CONTACT_AUDIT_TITLE);
    });
  });
});

const PERMISSION_GROUP = 'Settings';

async function seedOrg(
  pool: Pool,
  org: { slug: string; name: string },
  email: string,
  grants: string[],
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
    [org.name, org.slug],
  );
  const orgId = Number(res.rows[0].id);
  await seedMember(pool, orgId, email, 'Admin', grants);
  return orgId;
}

/**
 * A member whose role grants exactly `grants`. `is_system` is forced false:
 * sign-in reconciles a built-in role name up to the full grant set that name
 * carries, which would hand the Organizer the `setUsers` the scoping test
 * depends on them NOT having.
 */
async function seedMember(
  pool: Pool,
  orgId: number,
  email: string,
  roleName: string,
  grants: string[],
): Promise<void> {
  for (const key of grants) {
    // 0052 already seeded the catalogue; this is a no-op on a migrated DB.
    await pool.query(
      `INSERT INTO permissions (key, "group", label) VALUES ($1,$2,$1)
       ON CONFLICT (key) DO NOTHING`,
      [key, PERMISSION_GROUP],
    );
  }
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, name, description, is_system)
     VALUES ($1,$2,'seed',false) RETURNING id`,
    [orgId, `Seed ${roleName}`],
  );
  for (const key of grants) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_key, granted)
       VALUES ($1,$2,true)`,
      [Number(role.rows[0].id), key],
    );
  }
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
     VALUES ($1,$2,$3,'admin','Active',$4) RETURNING id`,
    [orgId, roleName, email, await hash(PASSWORD)],
  );
  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role_id, role, status)
     VALUES ($1,$2,$3,$4,'Active')`,
    [orgId, user.rows[0].id, Number(role.rows[0].id), roleName],
  );
}

async function scopedDelete(
  pool: Pool,
  slugs: string[],
  tables: string[],
): Promise<void> {
  const scoped = `organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`;
  for (const table of tables) {
    await pool.query(`DELETE FROM ${table} WHERE ${scoped}`, [slugs]);
  }
}

async function cleanup(pool: Pool): Promise<void> {
  const slugs = [ORG.slug, ORG2.slug];
  // audit_events leads: its organizations reference is the schema's single
  // ON DELETE RESTRICT, so the organization delete fails while the trail holds.
  await scopedDelete(pool, slugs, ['audit_events', 'attendees']);
  await pool.query(
    `DELETE FROM memberships WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = ANY($1))`,
    [slugs],
  );
  await pool.query(
    `DELETE FROM role_permissions WHERE role_id IN
       (SELECT id FROM roles WHERE organization_id IN
          (SELECT id FROM organizations WHERE slug = ANY($1)))`,
    [slugs],
  );
  await scopedDelete(pool, slugs, ['roles', 'users']);
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [slugs]);
}
