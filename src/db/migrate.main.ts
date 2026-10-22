/**
 * The production migration entry point: `node dist/db/migrate.main.js`.
 *
 * A twelve-factor admin process (XII): a one-off run of the SAME image as the
 * release, with the same environment, from WORKDIR /app —
 *
 *   docker run --rm --env-file <env> eventa-api node dist/db/migrate.main.js
 *
 * and eventa-infra's api chart runs it as the pre-deploy migration Job. Plain
 * node, never npm or pnpm: the image has no tsx or drizzle-kit (devDependencies),
 * and a package manager writes under $HOME, which a read-only root filesystem
 * refuses. The database comes from DATABASE_URL only; there is no fallback.
 *
 * `pnpm migrate` runs the same code from source (scripts/migrate.ts); the
 * process itself is in migration-runner.ts.
 */
import { migrate, migrationSettingsFromEnv } from './migration-runner';

void migrate(() => migrationSettingsFromEnv(process.env, process.cwd())).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
);
