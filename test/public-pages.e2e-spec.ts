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
    await app.init();
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
  await pool.query(`DELETE FROM organizations WHERE slug = $1`, [ORG.slug]);
}
