import { writeFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Env } from './config/env.validation';

/** Build the OpenAPI document for the API (served under /api/v1). */
export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Eventa API')
    .setDescription(
      'Backend API for the Eventa event registration & management platform.',
    )
    .setVersion('1.0')
    .addServer('/api/v1')
    .addCookieAuth('session')
    .build();

  return SwaggerModule.createDocument(app, config);
}

/**
 * Serve Swagger UI at /api/docs (JSON at /api/docs/json) and, when EMIT_OPENAPI
 * is set in a non-production env, write openapi.json to the repo root — the
 * contract eventa-web generates its typed client from.
 */
export function setupOpenApi(
  app: INestApplication,
  config: ConfigService<Env, true>,
): void {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/json',
  });

  const emit = config.get('EMIT_OPENAPI', { infer: true });
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
  if (emit && !isProd) {
    writeFileSync('openapi.json', JSON.stringify(document, null, 2));
  }
}
