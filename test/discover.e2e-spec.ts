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

const ORG_A = { slug: 'disc-e2e-a', name: 'Discover E2E A' };
const ORG_B = { slug: 'disc-e2e-b', name: 'Discover E2E B' };

const TECH = 'dsc-bangkok-tech-week';
const GALA = 'dsc-sold-out-gala';
const RUN = 'dsc-selling-fast-run';
const MUSIC = 'dsc-chiang-mai-music';
const CAFE = 'dsc-cafe-social';
const DRAFT = 'dsc-draft-secret';
const UNLISTED = 'dsc-unlisted-party';
const STARTED = 'dsc-already-started';

const TECH_CATEGORY = 'Discover Technology';
const MUSIC_CATEGORY = 'Discover Music';
/** Only the seeded events carry this, so a search isolates them from the grid. */
const VENUE_MARKER = 'Dscx';
const BAHT = 100;

interface Card {
  id: string;
  slug: string;
  name: string;
  categoryName: string | null;
  city: string | null;
  venueName: string | null;
  coverImage: string | null;
  organizerName: string;
  isOnline: boolean;
  goingCount: number;
  priceFrom: string | null;
  badge: string | null;
  rating: number | null;
  startAt: string;
}
interface PageBody {
  data: Card[];
  meta: { total: number; page: number; limit: number; hasNext: boolean };
}

describe('Discover (e2e — US-DISC-01, US-DISC-02)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    await seed(pool);

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

  /** Deliberately never sends an Authorization header — Discover is anonymous. */
  const browse = async (query = ''): Promise<PageBody> => {
    const res = await request(server).get(`/api/v1/public/discover${query}`);
    expect(res.status).toBe(200);
    return res.body as PageBody;
  };

  const card = (page: PageBody, slug: string): Card | undefined =>
    page.data.find((c) => c.slug === slug);

  describe('US-DISC-01 — browse what is on', () => {
    it('opens with no account and shows every workspace’s public events', async () => {
      const page = await browse('?limit=48');
      // Two different organizations, one grid.
      expect(card(page, TECH)).toBeDefined();
      expect(card(page, MUSIC)).toBeDefined();
    });

    it('shows the details a visitor scans for', async () => {
      const tech = card(await browse('?limit=48'), TECH);
      expect(tech).toMatchObject({
        name: 'Bangkok Tech Week',
        categoryName: TECH_CATEGORY,
        city: 'Bangkok',
        organizerName: 'Acme Events',
        isOnline: false,
      });
      expect(tech?.venueName).toContain('QSNCC');
      expect(tech?.coverImage).toBe('https://cdn.test/tech.jpg');
    });

    it('quotes a price-from taken from the cheapest tier', async () => {
      expect(card(await browse('?limit=48'), TECH)?.priceFrom).toBe('฿1,200');
    });

    it('says Free rather than ฿0 for a free event', async () => {
      expect(card(await browse('?limit=48'), MUSIC)?.priceFrom).toBe('Free');
    });

    it('counts only confirmed registrations as going', async () => {
      // Seeded: confirmed 2 + 3 seats, plus a cancelled 4 that must not count.
      expect(card(await browse('?limit=48'), TECH)?.goingCount).toBe(5);
    });

    it('counts nobody going for an event with no registrations', async () => {
      expect(card(await browse('?limit=48'), RUN)?.goingCount).toBe(0);
    });

    it('badges a sold-out event Waitlist instead of a buy-now price', async () => {
      const gala = card(await browse('?limit=48'), GALA);
      expect(gala?.badge).toBe('waitlist');
      expect(gala?.priceFrom).toBeNull();
    });

    it('badges a nearly-full event Selling fast', async () => {
      expect(card(await browse('?limit=48'), RUN)?.badge).toBe('selling_fast');
    });

    it('leaves a healthy event unbadged', async () => {
      expect(card(await browse('?limit=48'), TECH)?.badge).toBeNull();
    });

    it('hides events that are unpublished, unlisted, or already under way', async () => {
      const page = await browse('?limit=48');
      expect(card(page, DRAFT)).toBeUndefined();
      expect(card(page, UNLISTED)).toBeUndefined();
      expect(card(page, STARTED)).toBeUndefined();
    });

    it('orders soonest first', async () => {
      const page = await browse(
        `?category=${encodeURIComponent(TECH_CATEGORY)}`,
      );
      const mine = page.data.map((c) => c.slug);
      // Seeded at +30d, +45d, +50d and +55d — the grid sorts them, not the seed.
      expect(mine).toEqual([TECH, GALA, RUN, CAFE]);
    });

    it('carries no rating until attendees have reviewed the event', async () => {
      expect(card(await browse('?limit=48'), TECH)?.rating).toBeNull();
    });

    it('links each card to its public event page by slug', async () => {
      const res = await request(server).get(`/api/v1/public/events/${TECH}`);
      expect(res.status).toBe(200);
    });
  });

  describe('US-DISC-02 — search and filter', () => {
    const q = (term: string) =>
      browse(`?q=${encodeURIComponent(term)}&limit=48`);

    it('matches on the event title', async () => {
      expect(card(await q('tech week'), TECH)).toBeDefined();
    });

    it('matches on the city', async () => {
      expect(card(await q('bangkok'), TECH)).toBeDefined();
    });

    it('matches on the venue', async () => {
      expect(card(await q('QSNCC'), TECH)).toBeDefined();
    });

    it('matches on the category name', async () => {
      expect(card(await q(MUSIC_CATEGORY), MUSIC)).toBeDefined();
    });

    it('ignores case', async () => {
      expect(card(await q('BANGKOK TECH WEEK'), TECH)).toBeDefined();
    });

    it('ignores stray spaces around the term', async () => {
      expect(card(await q('   tech week   '), TECH)).toBeDefined();
    });

    it('matches Thai text typed with its tone marks', async () => {
      expect(card(await q('เชียงใหม่'), MUSIC)).toBeDefined();
    });

    it('matches the same Thai text typed without tone marks', async () => {
      expect(card(await q('เชยงใหม'), MUSIC)).toBeDefined();
    });

    it('matches an accented name typed plainly', async () => {
      expect(card(await q('cafe social'), CAFE)).toBeDefined();
    });

    it('matches a plain name typed with an accent', async () => {
      expect(card(await q('café social'), CAFE)).toBeDefined();
    });

    it('updates the result count as the search narrows', async () => {
      const all = await q(VENUE_MARKER);
      const one = await q('sold out gala');
      expect(all.meta.total).toBeGreaterThan(one.meta.total);
      expect(one.meta.total).toBe(1);
    });

    it('narrows to a single category', async () => {
      const page = await browse(
        `?category=${encodeURIComponent(MUSIC_CATEGORY)}`,
      );
      expect(card(page, MUSIC)).toBeDefined();
      expect(card(page, TECH)).toBeUndefined();
    });

    it('applies a keyword and a category together', async () => {
      const page = await browse(
        `?q=gala&category=${encodeURIComponent(TECH_CATEGORY)}`,
      );
      expect(page.data.map((c) => c.slug)).toEqual([GALA]);
    });

    it('returns an empty page when a keyword and category match nothing', async () => {
      const page = await browse(
        `?q=gala&category=${encodeURIComponent(MUSIC_CATEGORY)}`,
      );
      expect(page.data).toEqual([]);
      expect(page.meta.total).toBe(0);
    });

    it('returns an empty page rather than an error for gibberish', async () => {
      const page = await q('zzzzz-no-such-event-zzzzz');
      expect(page.data).toEqual([]);
      expect(page.meta.total).toBe(0);
    });

    it('treats a `%` in the search as a literal, not a wildcard', async () => {
      expect((await q('%')).meta.total).toBe(0);
    });

    it('offers the categories that browsable events actually use', async () => {
      const res = await request(server).get(
        '/api/v1/public/discover/categories',
      );
      expect(res.status).toBe(200);
      const names = (res.body as { data: string[] }).data;
      expect(names).toContain(TECH_CATEGORY);
      expect(names).toContain(MUSIC_CATEGORY);
    });

    it('pages the grid with the standard meta block', async () => {
      const page = await browse(`?q=${VENUE_MARKER}&limit=2&page=1`);
      expect(page.data).toHaveLength(2);
      expect(page.meta).toMatchObject({ page: 1, limit: 2, hasNext: true });
      const second = await browse(`?q=${VENUE_MARKER}&limit=2&page=2`);
      expect(second.data[0].slug).not.toBe(page.data[0].slug);
    });

    it('rejects an outsized page size rather than serving the whole grid', async () => {
      const res = await request(server).get(
        '/api/v1/public/discover?limit=5000',
      );
      expect(res.status).toBe(400);
    });
  });
});

async function seed(pool: Pool): Promise<void> {
  const orgA = await insertOrg(pool, ORG_A);
  const orgB = await insertOrg(pool, ORG_B);
  const techCat = await insertCategory(pool, orgA, TECH_CATEGORY);
  const musicCat = await insertCategory(pool, orgB, MUSIC_CATEGORY);

  const tech = await insertEvent(pool, {
    orgId: orgA,
    slug: TECH,
    name: 'Bangkok Tech Week',
    categoryId: techCat,
    city: 'Bangkok',
    venue: `QSNCC ${VENUE_MARKER}Hall`,
    startsInDays: 30,
    cover: 'https://cdn.test/tech.jpg',
  });
  await insertTier(pool, orgA, tech, { price: 1_200 * BAHT, total: 100 });
  await insertTier(pool, orgA, tech, { price: 3_000 * BAHT, total: 50 });
  await insertOrder(pool, orgA, tech, { seats: 2, status: 'confirmed' });
  await insertOrder(pool, orgA, tech, { seats: 3, status: 'confirmed' });
  await insertOrder(pool, orgA, tech, { seats: 4, status: 'cancelled' });

  const gala = await insertEvent(pool, {
    orgId: orgA,
    slug: GALA,
    name: 'Sold Out Gala',
    categoryId: techCat,
    city: 'Bangkok',
    venue: `Riverside ${VENUE_MARKER}Hall`,
    startsInDays: 45,
  });
  await insertTier(pool, orgA, gala, {
    price: 5_000 * BAHT,
    total: 20,
    sold: 20,
  });

  const run = await insertEvent(pool, {
    orgId: orgA,
    slug: RUN,
    name: 'Selling Fast Run',
    categoryId: techCat,
    city: 'Bangkok',
    venue: `Lumpini ${VENUE_MARKER}Park`,
    startsInDays: 50,
  });
  await insertTier(pool, orgA, run, {
    price: 800 * BAHT,
    total: 100,
    sold: 92,
  });

  const cafe = await insertEvent(pool, {
    orgId: orgA,
    slug: CAFE,
    name: 'Café Social Bangkok',
    categoryId: techCat,
    city: 'Bangkok',
    venue: `Thonglor ${VENUE_MARKER}Loft`,
    startsInDays: 55,
  });
  await insertTier(pool, orgA, cafe, { price: 400 * BAHT, total: 40 });

  const music = await insertEvent(pool, {
    orgId: orgB,
    slug: MUSIC,
    name: 'เทศกาลดนตรีเชียงใหม่',
    categoryId: musicCat,
    city: 'เชียงใหม่',
    venue: `Nimman ${VENUE_MARKER}Stage`,
    startsInDays: 60,
  });
  await insertTier(pool, orgB, music, { price: 0, total: 500, isFree: true });

  // The three that must never appear.
  await insertEvent(pool, {
    orgId: orgA,
    slug: DRAFT,
    name: 'Draft Secret',
    categoryId: techCat,
    city: 'Bangkok',
    venue: `${VENUE_MARKER}Backroom`,
    startsInDays: 35,
    status: 'draft',
    visibility: 'private',
    published: false,
  });
  await insertEvent(pool, {
    orgId: orgA,
    slug: UNLISTED,
    name: 'Unlisted Party',
    categoryId: techCat,
    city: 'Bangkok',
    venue: `${VENUE_MARKER}Rooftop`,
    startsInDays: 36,
    visibility: 'unlisted',
  });
  await insertEvent(pool, {
    orgId: orgA,
    slug: STARTED,
    name: 'Already Started',
    categoryId: techCat,
    city: 'Bangkok',
    venue: `${VENUE_MARKER}Stadium`,
    startsInDays: -1,
  });
}

async function insertOrg(
  pool: Pool,
  org: { slug: string; name: string },
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`,
    [org.name, org.slug],
  );
  return Number(res.rows[0].id);
}

async function insertCategory(
  pool: Pool,
  orgId: number,
  name: string,
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO categories (organization_id, name, icon, color)
     VALUES ($1,$2,'star','pink') RETURNING id`,
    [orgId, name],
  );
  return Number(res.rows[0].id);
}

interface EventSeed {
  orgId: number;
  slug: string;
  name: string;
  categoryId: number;
  city: string;
  venue: string;
  startsInDays: number;
  cover?: string;
  status?: string;
  visibility?: string;
  published?: boolean;
}

async function insertEvent(pool: Pool, e: EventSeed): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO events (organization_id, slug, name, type, bucket, status, visibility,
                         category_id, start_at, end_at, timezone, organizer_name,
                         venue_name, city, cover_image, published_at)
     VALUES ($1,$2,$3,'Conference','active',$4,$5,$6,
             now() + ($7 || ' days')::interval,
             now() + ($7 || ' days')::interval + interval '6 hours',
             'Asia/Bangkok','Acme Events',$8,$9,$10,
             CASE WHEN $11 THEN now() ELSE NULL END)
     RETURNING id`,
    [
      e.orgId,
      e.slug,
      e.name,
      e.status ?? 'upcoming',
      e.visibility ?? 'public',
      e.categoryId,
      String(e.startsInDays),
      e.venue,
      e.city,
      e.cover ?? null,
      e.published ?? true,
    ],
  );
  return res.rows[0].id;
}

async function insertTier(
  pool: Pool,
  orgId: number,
  eventId: string,
  tier: { price: number; total: number; sold?: number; isFree?: boolean },
): Promise<void> {
  await pool.query(
    `INSERT INTO ticket_types (organization_id, event_id, name, price_satang,
                               is_free, status, total, sold)
     VALUES ($1,$2,'General',$3,$4,'onsale',$5,$6)`,
    [
      orgId,
      eventId,
      tier.price,
      tier.isFree ?? false,
      tier.total,
      tier.sold ?? 0,
    ],
  );
}

let orderSeq = 0;

async function insertOrder(
  pool: Pool,
  orgId: number,
  eventId: string,
  order: { seats: number; status: string },
): Promise<void> {
  orderSeq += 1;
  await pool.query(
    `INSERT INTO orders (organization_id, reference, event_id, buyer_name, buyer_email,
                         status, seats, subtotal_satang, total_satang)
     VALUES ($1,$2,$3,'Anan Test','anan@example.test',$4,$5,0,0)`,
    [orgId, `DSC-${orderSeq}`, eventId, order.status, order.seats],
  );
}

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [
    [ORG_A.slug, ORG_B.slug],
  ]);
}
