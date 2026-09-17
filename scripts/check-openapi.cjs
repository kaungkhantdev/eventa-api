/**
 * Does the OpenAPI document actually build from the COMPILED output?
 *
 * `pnpm check:openapi` — run it after `nest build`, which the npm script does.
 *
 * This exists because of a failure nothing else caught. Two report DTO modules
 * imported each other; `tsc` reported zero errors, 1,455 unit tests and 80 e2e
 * tests stayed green, and `pnpm start:dev` died on boot with "a circular
 * dependency has been detected in RegistrationChangesDto". `openapi.json` is
 * the contract eventa-web is written against, so a document that cannot be
 * built is not a documentation problem — it is an API that will not start.
 *
 * It has to run against `dist/`, not under ts-jest. A cycle like that resolves
 * to `undefined` or not depending on which module loads first, and jest's
 * resolver orders them differently from the compiled CommonJS that actually
 * ships — the equivalent jest test passes with the bug present.
 *
 * Needs the datastores up (`docker compose up -d`), because building the
 * document means initialising the real module graph.
 */
process.env.NODE_ENV ||= 'development';

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { buildOpenApiDocument } = require('../dist/openapi');

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
