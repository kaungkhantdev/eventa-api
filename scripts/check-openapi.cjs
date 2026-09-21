/**
 * Does the OpenAPI document actually build from the COMPILED output?
 *
 * `pnpm check:openapi` — the npm script builds first, into `dist-openapi/`
 * rather than `dist/`. That separation is deliberate: nest-cli sets
 * `deleteOutDir`, so building into `dist/` while somebody has `pnpm start:dev`
 * running deletes the directory their app is loaded from and leaves the
 * watcher with nothing to run.
 *
 * This exists because of a failure nothing else caught. Two report DTO modules
 * imported each other; `tsc` reported zero errors, 1,455 unit tests and 80 e2e
 * tests stayed green, and `pnpm start:dev` died on boot with "a circular
 * dependency has been detected in RegistrationChangesDto". `openapi.json` is
 * the contract eventa-web is written against, so a document that cannot be
 * built is not a documentation problem — it is an API that will not start.
 *
 * It has to run against COMPILED output, not under ts-jest. A cycle like that resolves
 * to `undefined` or not depending on which module loads first, and jest's
 * resolver orders them differently from the compiled CommonJS that actually
 * ships — the equivalent jest test passes with the bug present.
 *
 * Needs the datastores up (`docker compose up -d`), because building the
 * document means initialising the real module graph.
 */
process.env.NODE_ENV ||= 'development';

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist-openapi/app.module');
const { buildOpenApiDocument } = require('../dist-openapi/openapi');

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();
  try {
    const document = buildOpenApiDocument(app);
    const paths = Object.keys(document.paths ?? {}).length;
    const schemas = Object.keys(document.components?.schemas ?? {}).length;
    console.log(`OpenAPI OK — ${paths} paths, ${schemas} schemas.`);
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error('OpenAPI FAILED —', error.message);
    process.exit(1);
  },
);
