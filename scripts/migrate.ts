/**
 * `pnpm migrate` — apply pending migrations, each in its own transaction.
 *
 * Not `drizzle-kit migrate`, which applies every pending migration in ONE
 * transaction and therefore cannot build a fresh database: see
 * `src/db/migrator.ts`.
 *
 * The development and CI entry point. The process itself is
 * `src/db/migration-runner.ts`, which the production image runs compiled
 * (`node dist/db/migrate.main.js`), so the two cannot behave differently. What
 * this file adds is the connection from drizzle.config.ts, which falls back to
 * the docker-compose database when DATABASE_URL is unset — CI's e2e job
 * relies on that. The folder is MIGRATIONS_FOLDER, the one drizzle.config.ts
 * generates into.
 *
 * Lives outside `src/` on purpose: the build is scoped to `src/`, and importing
 * the root-level drizzle.config.ts from there would widen its rootDir.
 */
import config from '../drizzle.config';
import { migrate, migrationsFolder } from '../src/db/migration-runner';

/** drizzle-kit types its config as a union, so the credentials are narrowed to. */
function connectionString(): string {
  const credentials =
    'dbCredentials' in config
      ? (config.dbCredentials as { url?: string } | undefined)
      : undefined;
  if (!credentials?.url) {
    throw new Error('drizzle.config.ts has no dbCredentials.url');
  }
  return credentials.url;
}

void migrate(() => ({
  databaseUrl: connectionString(),
  migrationsFolder: migrationsFolder(process.cwd()),
})).then((exitCode) => {
  process.exitCode = exitCode;
});
