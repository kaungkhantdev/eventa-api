// Env must be valid before ConfigModule validates it at module compile time.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://eventa:eventa@localhost:5432/eventa';

import type { Server } from 'node:http';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CORRELATION_ID_HEADER } from '../src/common/context/correlation-id.middleware';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/live → 200 { status: ok }', async () => {
    const res = await request(server).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('echoes a supplied correlation id on the response', async () => {
    const res = await request(server)
      .get('/api/v1/health/live')
      .set(CORRELATION_ID_HEADER, 'test-correlation-123');
    expect(res.headers[CORRELATION_ID_HEADER]).toBe('test-correlation-123');
  });

  it('GET /api/v1/health/ready → well-formed readiness body', async () => {
    const res = await request(server).get('/api/v1/health/ready');
    const body = res.body as {
      status: string;
      checks: Record<string, string>;
    };
    expect([200, 503]).toContain(res.status);
    expect(body.checks).toHaveProperty('database');
    expect(['ok', 'error']).toContain(body.status);
  });
});
