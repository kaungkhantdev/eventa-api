import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { envSchema } from '../config/env.validation';
import { MIGRATIONS_FOLDER } from './drizzle.constants';
import { drizzleTarget, migrateEach, type MigrationTarget } from './migrator';

/**
 * The migration PROCESS, around the one-transaction-per-migration rule in
 * migrator.ts: where the SQL is, which database, what the log and the exit
 * code say. One implementation with two entry points —
 *
 *   - `pnpm migrate` (scripts/migrate.ts, run by tsx) in development and CI;
 *   - `node dist/db/migrate.main.js` in the production image, a one-off admin
 *     process of the same image and config as the release (twelve-factor XII).
 *
 * Nothing here imports drizzle-kit or drizzle.config.ts: both are development
 * tooling, and the production image carries production dependencies only.
 */

export interface MigrationSettings {
  readonly databaseUrl: string;
  /** Absolute path of the folder holding the SQL and meta/_journal.json. */
  readonly migrationsFolder: string;
}

/** Where the process reports to: stdout and stderr, as console does. */
export interface MigrationLog {
  log(message: string): void;
  error(message: string): void;
}

/** An open database: the target to migrate, and how to let it go. */
export interface MigrationConnection {
  readonly target: MigrationTarget;
  close(): Promise<void>;
}

export interface MigrationDeps {
  readonly log: MigrationLog;
  readonly connect: (databaseUrl: string) => MigrationConnection;
}

const LOG_PREFIX = '[migrate]';
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;

/** The real database: one pg pool, closed when the run ends. */
export function connectToDatabase(databaseUrl: string): MigrationConnection {
  const pool = new Pool({ connectionString: databaseUrl });
  return { target: drizzleTarget(drizzle(pool)), close: () => pool.end() };
}

const DEFAULT_DEPS: MigrationDeps = {
  log: console,
  connect: connectToDatabase,
};

/** The migrations folder, resolved against the working directory. */
export function migrationsFolder(cwd: string): string {
  return resolve(cwd, MIGRATIONS_FOLDER);
}

/**
 * The production entry's settings, from the environment only (twelve-factor
 * III): DATABASE_URL under the app's own rule for it, and none of the rest of
 * the app's config, which a migration has no use for.
 */
export function migrationSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): MigrationSettings {
  const parsed = envSchema.pick({ DATABASE_URL: true }).safeParse(env);
  if (!parsed.success) {
    throw new Error('DATABASE_URL is required: set it in the environment');
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    migrationsFolder: migrationsFolder(cwd),
  };
}

/**
 * Why it failed, in one line. drizzle wraps the driver's error and keeps it as
 * the cause, so the cause carries Postgres's own sentence. Only the message is
 * logged, never the error object, which can hold the query's parameters.
 */
export function failureReason(error: unknown): string {
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  if (!(cause instanceof Error)) return String(cause);
  const code = (cause as { code?: unknown }).code;
  return cause.message || (typeof code === 'string' ? code : cause.name);
}

/** The file name of each migration by its timestamp: drizzle's reader keeps only the timestamp. */
function migrationTags(folder: string): ReadonlyMap<number, string> {
  const journal = JSON.parse(
    readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string; when: number }[] };
  return new Map(journal.entries.map((entry) => [entry.when, entry.tag]));
}

/** Apply, logging each migration as it commits. False when one failed. */
async function applyAndReport(
  target: MigrationTarget,
  migrations: MigrationMeta[],
  tags: ReadonlyMap<number, string>,
  log: MigrationLog,
): Promise<boolean> {
  let lastApplied: string | null = null;
  try {
    const applied = await migrateEach(target, migrations, (migration) => {
      lastApplied =
        tags.get(migration.folderMillis) ?? String(migration.folderMillis);
      log.log(`${LOG_PREFIX} applied ${lastApplied}`);
    });
    log.log(summary(applied));
    return true;
  } catch (error) {
    // Everything before the failure is committed; the next run resumes there.
    const after = lastApplied ?? 'none';
    log.error(`${LOG_PREFIX} FAILED after ${after}: ${failureReason(error)}`);
    return false;
  }
}

function summary(applied: number): string {
  return applied === 0
    ? `${LOG_PREFIX} nothing to apply — the database is up to date`
    : `${LOG_PREFIX} ${applied} migration(s) applied`;
}

/** Apply every pending migration. False when one failed. */
export async function runMigrations(
  settings: MigrationSettings,
  deps: MigrationDeps = DEFAULT_DEPS,
): Promise<boolean> {
  const migrations = readMigrationFiles({
    migrationsFolder: settings.migrationsFolder,
  });
  const tags = migrationTags(settings.migrationsFolder);
  const connection = deps.connect(settings.databaseUrl);
  try {
    return await applyAndReport(connection.target, migrations, tags, deps.log);
  } finally {
    await connection.close();
  }
}

/**
 * What an entry point runs: the whole migration, ending in the exit code the
 * process should end with. Anything thrown on the way — no DATABASE_URL, no
 * migrations folder — is logged and becomes a failure, so a Job fails its
 * sync with a reason instead of on an unhandled rejection.
 */
export async function migrate(
  resolveSettings: () => MigrationSettings,
  deps: MigrationDeps = DEFAULT_DEPS,
): Promise<number> {
  try {
    const ok = await runMigrations(resolveSettings(), deps);
    return ok ? EXIT_SUCCESS : EXIT_FAILURE;
  } catch (error) {
    deps.log.error(`${LOG_PREFIX} FAILED: ${failureReason(error)}`);
    return EXIT_FAILURE;
  }
}
