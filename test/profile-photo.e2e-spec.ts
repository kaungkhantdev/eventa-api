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
import { ObjectStoragePort } from '../src/modules/profile-photo/ports/object-storage.port';
import { MemoryObjectStorageAdapter } from './doubles/memory-object-storage.adapter';

const PASSWORD = 'correct horse battery staple';
const RUN = Date.now();
const ANAN = `anan-${RUN}@photo.test`;
const MALEE = `malee-${RUN}@photo.test`;
const JPEG = 'image/jpeg';
const SIZE = 20_480;
/** Real JPEG magic; the confirm step reads these bytes, not the client's claim. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const HTML_BYTES = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]);

interface Success<T> {
  data: T;
}
interface UploadBody {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

describe('Profile photo (e2e — US-DISC-11)', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  let storage: MemoryObjectStorageAdapter;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup(pool);
    const passwordHash = await hash(PASSWORD);
    for (const email of [ANAN, MALEE]) {
      await pool.query(
        `INSERT INTO users (organization_id, name, email, persona, status, password_hash)
         SELECT id, 'Attendee', $1, 'attendee', 'Active', $2
         FROM organizations WHERE slug = 'eventa'`,
        [email, passwordHash],
      );
    }

    // The double is installed here rather than selected by an env var: the app
    // has one storage backend, and a suite that wants a different one says so
    // out loud. `useClass` also guarantees a SINGLE instance behind the token,
    // so the bytes this test hands to `receive` are the bytes the service reads.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ObjectStoragePort)
      .useClass(MemoryObjectStorageAdapter)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    server = app.getHttpServer() as Server;
    storage = app.get(ObjectStoragePort);
  }, 30000);

  afterAll(async () => {
    await cleanup(pool);
    await pool.end();
    await app.close();
  });

  const login = async (email: string): Promise<string> => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, persona: 'attendee' });
    expect(res.status).toBe(200);
    return (res.body as Success<{ accessToken: string }>).data.accessToken;
  };

  const requestUpload = (jwt: string, body: Record<string, unknown> = {}) =>
    request(server)
      .post('/api/v1/me/photo/upload-url')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ contentType: JPEG, byteSize: SIZE, ...body });

  const confirm = (jwt: string, key: string) =>
    request(server)
      .post('/api/v1/me/photo')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ key });

  const profile = (jwt: string) =>
    request(server)
      .get('/api/v1/me/profile')
      .set('Authorization', `Bearer ${jwt}`);

  it('issues an upload URL scoped to the caller, then shows the photo once confirmed', async () => {
    const jwt = await login(ANAN);
    const issued = await requestUpload(jwt);
    expect(issued.status).toBe(200);
    const upload = (issued.body as Success<UploadBody>).data;
    expect(upload.headers['content-type']).toBe(JPEG);
    expect(upload.headers['content-length']).toBe(String(SIZE));
    expect(upload.expiresInSeconds).toBeGreaterThan(0);

    expect(upload.key.startsWith('uploads/')).toBe(true);

    // Stand in for the browser PUTting the bytes straight to storage.
    storage.receive(
      upload.key,
      { contentType: JPEG, byteSize: SIZE },
      JPEG_BYTES,
    );

    const confirmed = await confirm(jwt, upload.key);
    expect(confirmed.status).toBe(200);
    const shown = (await profile(jwt)).body as Success<{
      avatarUrl: string | null;
    }>;
    // Served from the final prefix — a key that was never presigned…
    expect(shown.data.avatarUrl).toContain('avatars/');
    expect(shown.data.avatarUrl).not.toContain('uploads/');
    // …and the staging object is gone, so the live URL cannot be re-PUT.
    expect(await storage.head(upload.key)).toBeNull();
  });

  it('refuses to confirm an upload that never arrived', async () => {
    const jwt = await login(ANAN);
    const upload = (await requestUpload(jwt)).body as Success<UploadBody>;
    const res = await confirm(jwt, upload.data.key); // nothing received
    expect(res.status).toBe(422);
  });

  it('refuses to confirm someone else’s key', async () => {
    const anan = await login(ANAN);
    const malee = await login(MALEE);
    const upload = (await requestUpload(anan)).body as Success<UploadBody>;
    storage.receive(
      upload.data.key,
      { contentType: JPEG, byteSize: SIZE },
      JPEG_BYTES,
    );

    const stolen = await confirm(malee, upload.data.key);
    expect(stolen.status).toBe(403);
    const maleeProfile = (await profile(malee)).body as Success<{
      avatarUrl: string | null;
    }>;
    expect(maleeProfile.data.avatarUrl).toBeNull();
  });

  it('bins HTML wearing an image content type — the bytes decide, not the claim', async () => {
    const jwt = await login(ANAN);
    const upload = (await requestUpload(jwt)).body as Success<UploadBody>;
    // A signed PUT forces the STORED type to equal the DECLARED one, so this is
    // exactly what an attacker can achieve: image/jpeg on the tin, HTML inside.
    storage.receive(
      upload.data.key,
      { contentType: JPEG, byteSize: SIZE },
      HTML_BYTES,
    );
    const res = await confirm(jwt, upload.data.key);
    expect(res.status).toBe(422);
    expect(await storage.head(upload.data.key)).toBeNull();
    // The rejected object never becomes anyone's photo (an earlier case in this
    // suite left a valid one, so assert on THIS upload's id, not on null).
    const id = upload.data.key.split('/').pop() as string;
    const shown = (await profile(jwt)).body as Success<{
      avatarUrl: string | null;
    }>;
    expect(shown.data.avatarUrl ?? '').not.toContain(id);
  });

  it('refuses an Object.prototype key as a content type', async () => {
    const jwt = await login(ANAN);
    const res = await requestUpload(jwt, { contentType: 'constructor' });
    expect(res.status).toBe(400);
  });

  it('refuses a type we do not serve, and an oversized file, before issuing a URL', async () => {
    const jwt = await login(ANAN);
    // Rejected by the DTO allow-list before the service is even reached.
    expect(
      (await requestUpload(jwt, { contentType: 'application/pdf' })).status,
    ).toBe(400);
    expect((await requestUpload(jwt, { byteSize: 50_000_000 })).status).toBe(
      422,
    );
    expect((await requestUpload(jwt, { byteSize: 0 })).status).toBe(400);
  });

  it('no longer accepts a hand-written avatarUrl on the profile', async () => {
    const jwt = await login(ANAN);
    const res = await request(server)
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ avatarUrl: 'https://evil.test/tracker.png' });
    // The field is gone from the DTO, so the whitelist rejects it outright.
    expect(res.status).toBe(400);
  });

  it('clears the photo on delete', async () => {
    const jwt = await login(ANAN);
    const upload = (await requestUpload(jwt)).body as Success<UploadBody>;
    storage.receive(
      upload.data.key,
      { contentType: JPEG, byteSize: SIZE },
      JPEG_BYTES,
    );
    const confirmed = await confirm(jwt, upload.data.key);
    const live = (confirmed.body as Success<{ avatarUrl: string }>).data
      .avatarUrl;

    const removed = await request(server)
      .delete('/api/v1/me/photo')
      .set('Authorization', `Bearer ${jwt}`);
    expect(removed.status).toBe(204);

    const shown = (await profile(jwt)).body as Success<{
      avatarUrl: string | null;
    }>;
    expect(shown.data.avatarUrl).toBeNull();
    expect(
      await storage.head(live.split('/object-storage/')[1] ?? ''),
    ).toBeNull();
  });

  it('needs a session — an anonymous caller gets nothing', async () => {
    const res = await request(server)
      .post('/api/v1/me/photo/upload-url')
      .send({ contentType: JPEG, byteSize: SIZE });
    expect(res.status).toBe(401);
  });
});

async function cleanup(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM users WHERE email LIKE '%@photo.test'`);
}
