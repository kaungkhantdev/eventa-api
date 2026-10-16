/**
 * `pnpm migrate` — apply pending migrations, each in its own transaction.
 *
 * Not `drizzle-kit migrate`, which applies every pending migration in ONE
 * transaction and therefore cannot build a fresh database: see
 * `src/db/migrator.ts`. The connection and the folder are read from
 * drizzle.config.ts, so `pnpm generate` and this can never disagree about
 * where migrations live or which database they are for.
 *
 * Lives outside `src/` on purpose: the build is scoped to `src/`, and importing
 * the root-level drizzle.config.ts from there would widen its rootDir.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Pool } from 'pg';
import config from '../drizzle.config';
import { drizzleTarget, migrateEach } from '../src/db/migrator';

interface Journal {
  entries: { tag: string; when: number }[];
}

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

/** Postgres's own sentence: drizzle wraps the driver's error and keeps it as the cause. */
function reasonOf(error: unknown): string {
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  return cause instanceof Error ? cause.message : String(cause);
}

async function main(): Promise<void> {
  const folder = config.out ?? './drizzle';
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  // The file names, for reporting: drizzle's reader keeps only `when`.
  const journal = JSON.parse(
    readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
  const tagOf = new Map(journal.entries.map((e) => [e.when, e.tag]));

  const pool = new Pool({ connectionString: connectionString() });
  let lastApplied: string | null = null;
  try {
    const applied = await migrateEach(
      drizzleTarget(drizzle(pool)),
      migrations,
      (migration) => {
        lastApplied =
          tagOf.get(migration.folderMillis) ?? String(migration.folderMillis);
        console.log(`[migrate] applied ${lastApplied}`);
      },
    );
    console.log(
      applied === 0
        ? '[migrate] nothing to apply — the database is up to date'
        : `[migrate] ${applied} migration(s) applied`,
    );
  } catch (error) {
    // Everything before the failure is committed; the next run resumes there.
    console.error(
      `[migrate] FAILED after ${lastApplied ?? 'none'}:`,
      reasonOf(error),
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
