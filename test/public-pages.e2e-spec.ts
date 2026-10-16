process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';
process.env.JWT_SECRET ??= 'test-secret-at-least-16-characters-long';

import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/http/validation';
import { LANDING_TEMPLATES } from '../src/modules/events/landing-templates';
import { listenOnLoopback } from './support/loopback';

const ORG = { slug: 'page-e2e', name: 'Page E2E' };
const LIVE = 'live-summit';
const DRAFT = 'draft-summit';

interface Success<T> {
  data: T;
}
interface Page {
  event: {
    name: string;
    isOnline: boolean;
    venueAddress: string | null;
    venueName: string | null;
    onlineNote: string | null;
    accentColor: string;
    template: string;
  };
  highlights: { text: string }[];
  faqs: { question: string }[];
  tickets: {
    name: string;
    priceLabel: string;
    soldOut: boolean;
    canRegister: boolean;
    urgency: string | null;
    isRecommended: boolean;
    badge: string | null;
  }[];
  registration: { open: boolean; reason: string | null };
  share: { url: string; noIndex: boolean; image: string | null };
  sections: { agenda: string; speakers: string };
  agenda: { title: string; speakerNames: string[] }[];
  speakers: { name: string }[];
}

describe('Public event page (e2e — US-PAGE-01…08)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let orgId: number;
  let liveId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    ({ orgId, liveId } = await seed(pool));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await listenOnLoopback(app);
    server = app.getHttpServer() as Server;
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const page = (slug: string) =>
    request(server).get(`/api/v1/public/events/${slug}`);

  it('US-PAGE-01: opens anonymously — no token, no sign-in prompt', async () => {
    const res = await page(LIVE); // deliberately NO Authorization header
    expect(res.status).toBe(200);
    const p = (res.body as Success<Page>).data;
    expect(p.event.name).toBe('Live Summit');
    expect(p.event.venueName).toBe('BITEC');
  });

  it('US-PAGE-01: an unpublished event is not available', async () => {
    const res = await page(DRAFT);
    expect(res.status).toBe(404);
    expect((res.body as { message: string }).message).toMatch(
      /isn't available/i,
    );
  });

  it('US-PAGE-01: an unknown slug is not available (never the wrong event)', async () => {
    expect((await page('no-such-event')).status).toBe(404);
  });

  it('US-PAGE-01: empty sections come back empty, never as blank headings', async () => {
    const p = (await page(LIVE)).body as Success<Page>;
    expect(p.data.faqs).toEqual([]); // none seeded
  });

  it('US-PAGE-04/06: highlights and FAQs render in the arranged order', async () => {
    await pool.query(
      `INSERT INTO event_highlights (organization_id, event_id, text, position)
       VALUES ($1,$2,'Second',1), ($1,$2,'First',0)`,
      [orgId, liveId],
    );
    await pool.query(
      `INSERT INTO event_faqs (organization_id, event_id, question, answer, position)
       VALUES ($1,$2,'Parking?','Yes, B2.',0)`,
      [orgId, liveId],
    );
    const p = ((await page(LIVE)).body as Success<Page>).data;
    expect(p.highlights.map((h) => h.text)).toEqual(['First', 'Second']);
    expect(p.faqs[0].question).toBe('Parking?');
  });

  // Ids are random UUIDs, so these are chosen to sort apart from the order of
  // entry, and the names likewise: only the entry order gives Somchai first.
  it('US-PAGE-04: speakers render in the order the organizer added them', async () => {
    await pool.query(
      `INSERT INTO speakers (id, organization_id, event_id, name, created_at)
       VALUES ('cccccccc-0000-4000-8000-000000000001',$1,$2,'Somchai', now() - interval '3 minutes'),
              ('eeeeeeee-0000-4000-8000-000000000002',$1,$2,'Ada', now() - interval '2 minutes'),
              ('aaaaaaaa-0000-4000-8000-000000000003',$1,$2,'Malee', now() - interval '1 minute')`,
      [orgId, liveId],
    );
    const p = ((await page(LIVE)).body as Success<Page>).data;
    expect(p.speakers.map((sp) => sp.name)).toEqual([
      'Somchai',
      'Ada',
      'Malee',
    ]);
  });

  it('US-PROG-11: a deleted speaker leaves the public agenda and speakers section', async () => {
    const speakers = await pool.query<{ id: string; name: string }>(
      `INSERT INTO speakers (organization_id, event_id, name)
       VALUES ($1,$2,'Dropout Dan'), ($1,$2,'Kanya') RETURNING id, name`,
      [orgId, liveId],
    );
    const session = await pool.query<{ id: string }>(
      `INSERT INTO sessions (organization_id, event_id, day, start_time, title, type)
       VALUES ($1,$2,1,'09:00','Opening Panel','Panel') RETURNING id`,
      [orgId, liveId],
    );
    for (const sp of speakers.rows) {
      await pool.query(
        `INSERT INTO session_speakers (session_id, speaker_id) VALUES ($1,$2)`,
        [session.rows[0].id, sp.id],
      );
    }
    // Removal is a soft delete that keeps the session links, as the console's does.
    await pool.query(
      `UPDATE speakers SET deleted_at = now() WHERE event_id = $1 AND name = 'Dropout Dan'`,
      [liveId],
    );

    const p = ((await page(LIVE)).body as Success<Page>).data;
    const panel = p.agenda.find((x) => x.title === 'Opening Panel');
    expect(panel?.speakerNames).toEqual(['Kanya']);
    expect(p.speakers.map((sp) => sp.name)).not.toContain('Dropout Dan');
  });

  it('US-PAGE-05: prices are VAT-inclusive Baht; sold-out cannot register', async () => {
    await pool.query(
      `INSERT INTO ticket_types (organization_id, event_id, name, price_satang, is_free, total, sold, is_recommended, badge)
       VALUES ($1,$2,'General',107000,false,100,0,true,'Most popular'),
              ($1,$2,'Late',50000,false,5,5,false,null),
              ($1,$2,'Free entry',0,true,50,0,false,null)`,
      [orgId, liveId],
    );
    const p = ((await page(LIVE)).body as Success<Page>).data;
    const general = p.tickets.find((t) => t.name === 'General');
    const late = p.tickets.find((t) => t.name === 'Late');
    const free = p.tickets.find((t) => t.name === 'Free entry');

    expect(general).toMatchObject({
      priceLabel: '฿1,070',
      isRecommended: true,
      badge: 'Most popular',
      canRegister: true,
    });
    expect(late).toMatchObject({ soldOut: true, canRegister: false });
    expect(free?.priceLabel).toBe('Free');
  });

  it('US-PAGE-05: an urgency line appears when few remain', async () => {
    await pool.query(
      `INSERT INTO ticket_types (organization_id, event_id, name, price_satang, is_free, total, sold)
       VALUES ($1,$2,'Almost gone',20000,false,100,97)`,
      [orgId, liveId],
    );
    const p = ((await page(LIVE)).body as Success<Page>).data;
    const tier = p.tickets.find((t) => t.name === 'Almost gone');
    expect(tier?.urgency).toMatch(/only 3 left/i);
  });

  it('US-PAGE-03: an online event never exposes an address', async () => {
    await pool.query(
      `UPDATE events SET is_online = true, online_note = 'Link sent after you register'
        WHERE id = $1`,
      [liveId],
    );
    const p = ((await page(LIVE)).body as Success<Page>).data;
    expect(p.event.isOnline).toBe(true);
    expect(p.event.venueAddress).toBeNull();
    expect(p.event.venueName).toBeNull();
    expect(p.event.onlineNote).toMatch(/after you register/i);
    // and nothing anywhere in the payload leaks a join URL
    expect(JSON.stringify(p)).not.toMatch(/zoom\.us|meet\.google|teams\./i);
    await pool.query(`UPDATE events SET is_online = false WHERE id = $1`, [
      liveId,
    ]);
  });

  it('US-PAGE-08: the share card carries a clean public URL and is indexable', async () => {
    const p = ((await page(LIVE)).body as Success<Page>).data;
    expect(p.share.url).toMatch(new RegExp(`/e/${LIVE}$`));
    expect(p.share.url).not.toContain('?');
    expect(p.share.noIndex).toBe(false);
  });

  it('US-PAGE-07: the calendar entry is downloadable, in UTC, with a stable UID', async () => {
    const res = await request(server).get(
      `/api/v1/public/events/${LIVE}/calendar.ics`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    const ics = res.text;
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Live Summit');
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    // same UID every time → re-adding updates rather than duplicating
    const uid = /UID:(.+)/.exec(ics)?.[1];
    const again = await request(server).get(
      `/api/v1/public/events/${LIVE}/calendar.ics`,
    );
    expect(/UID:(.+)/.exec(again.text)?.[1]).toBe(uid);
  });
});

async function seed(pool: Pool): Promise<{ orgId: number; liveId: string }> {
  // The live event below names the 'aurora' template, and a fresh database
  // has none until a later suite or `pnpm seed` writes them. Seeded here, as
  // publish.e2e-spec.ts does, so this suite never depends on run order.
  for (const t of LANDING_TEMPLATES) {
    await pool.query(
      `INSERT INTO landing_templates (id, title, badge, description)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [t.id, t.title, t.badge, t.description],
    );
  }
  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [ORG.name, ORG.slug],
  );
  const orgId = Number(org.rows[0].id);
  const live = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, description, type, bucket, status,
                         visibility, start_at, end_at, organizer_name, venue_name,
                         venue_address, city, published_at, landing_template_id, accent_color)
     VALUES ($1,$2,'Live Summit','A great day','Conference','active','upcoming','public',
             now() + interval '30 days', now() + interval '30 days 8 hours','Acme','BITEC',
             '88 Bangna','Bangkok', now(), 'aurora', '#1D4ED8')
     RETURNING id`,
    [orgId, LIVE],
  );
  await pool.query(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         start_at, organizer_name)
     VALUES ($1,$2,'Draft Summit','Conference','active','draft','private',
             now() + interval '30 days','Acme')`,
    [orgId, DRAFT],
  );
  return { orgId, liveId: live.rows[0].id };
}

async function cleanup(pool: Pool): Promise<void> {
  // audit_events is ON DELETE RESTRICT (a sign-in writes one), so clear it first.
  await pool.query(
    `DELETE FROM audit_events WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug = $1)`,
    [ORG.slug],
  );
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
