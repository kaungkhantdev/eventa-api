import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { setupOpenApi } from './openapi';

type TypedConfig = ConfigService<Env, true>;

function resolveCorsOrigins(config: TypedConfig): true | string[] {
  const origins = config.get('CORS_ORIGINS', { infer: true });
  return origins === '*' ? true : origins.split(',').map((o) => o.trim());
}

function configureApp(app: INestApplication, config: TypedConfig): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableShutdownHooks();
  app.enableCors({ origin: resolveCorsOrigins(config), credentials: true });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get<TypedConfig>(ConfigService);
  configureApp(app, config);
  setupOpenApi(app, config);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  app
    .get(Logger)
    .log(`eventa-api listening on :${port} (prefix /api/v1)`, 'Bootstrap');
}

void bootstrap();
