import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { MigrationTarget } from './migrator';
import {
  failureReason,
  migrate,
  type MigrationConnection,
  migrationSettingsFromEnv,
  migrationsFolder,
  runMigrations,
} from './migration-runner';

/**
 * The migration process — what `pnpm migrate` (development, CI) and
 * `node dist/db/migrate.main.js` (the production image) both run.
 *
 * The order and transaction boundaries are migrator.spec's. What is held here
 * is everything around them: where the SQL is, where the database comes from,
 * what the log says and what the exit code says — the parts a deployment
 * depends on and a fresh-database CI run does not exercise on its own.
 */

const REPO_ROOT = join(__dirname, '..', '..');
const FOLDER = migrationsFolder(REPO_ROOT);
const MIGRATIONS = readMigrationFiles({ migrationsFolder: FOLDER });
const NEWEST = MIGRATIONS[MIGRATIONS.length - 1].folderMillis;
const DATABASE_URL = 'postgres://eventa:eventa@db.internal:5432/eventa';

/** A log that remembers its lines. */
function recordingLog() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    log: {
      log: (message: string) => void lines.push(message),
      error: (message: string) => void errors.push(message),
    },
  };
}

/** A database that has applied everything up to `lastAppliedAt`. */
function fakeConnection(
  lastAppliedAt: number | null,
  failure?: Error,
): MigrationConnection & { closed: boolean; urls: string[] } {
  const target: MigrationTarget = {
    prepare: () => (failure ? Promise.reject(failure) : Promise.resolve()),
    lastAppliedAt: () => Promise.resolve(lastAppliedAt),
    applyOne: () => Promise.resolve(),
  };
  const connection = {
    target,
    closed: false,
    urls: [] as string[],
    close: () => {
      connection.closed = true;
      return Promise.resolve();
    },
  };
  return connection;
}

function depsFor(
  connection: ReturnType<typeof fakeConnection>,
  log: ReturnType<typeof recordingLog>['log'],
) {
  return {
    log,
    connect: (url: string) => {
      connection.urls.push(url);
      return connection;
    },
  };
}

describe('where the migrations are', () => {
  // Resolved from the working directory, so the one relative path works in a
  // checkout (the repo root) and in the image (WORKDIR /app), which ships the
  // SQL at the same place.
  it('is src/db/migrations under the working directory', () => {
    expect(migrationsFolder('/app')).toBe('/app/src/db/migrations');
  });

  it('is the folder drizzle-kit generates into, journal and all', () => {
    expect(existsSync(join(FOLDER, 'meta', '_journal.json'))).toBe(true);
    expect(MIGRATIONS.length).toBeGreaterThan(0);
  });
});

describe('settings from the environment', () => {
  // A one-off admin process of the release it migrates for: the same
  // variables, and nothing read from a file.
  it('takes the database from DATABASE_URL alone, without the rest of the app config', () => {
    expect(migrationSettingsFromEnv({ DATABASE_URL }, '/app')).toEqual({
      databaseUrl: DATABASE_URL,
      migrationsFolder: '/app/src/db/migrations',
    });
  });

  it('refuses to start without DATABASE_URL, naming it', () => {
    expect(() => migrationSettingsFromEnv({}, '/app')).toThrow(
      /DATABASE_URL is required/,
    );
  });

  it('refuses an empty DATABASE_URL', () => {
    expect(() =>
      migrationSettingsFromEnv({ DATABASE_URL: '' }, '/app'),
    ).toThrow(/DATABASE_URL is required/);
  });
});

describe('failureReason', () => {
  it("gives Postgres's own sentence, which drizzle keeps as the cause", () => {
    const wrapped = new Error('Failed query: CREATE TABLE …', {
      cause: new Error('relation "events" already exists'),
    });
    expect(failureReason(wrapped)).toBe('relation "events" already exists');
  });

  it('gives the message of an error nothing wrapped', () => {
    expect(failureReason(new Error('no journal'))).toBe('no journal');
  });

  // A refused connection to a host with two addresses is an AggregateError
  // with an empty message; without the code the log would end in a colon.
  it('falls back to the error code when the message is empty', () => {
    const refused = Object.assign(new AggregateError([], ''), {
      code: 'ECONNREFUSED',
    });
    const wrapped = new Error('Failed query', { cause: refused });
    expect(failureReason(wrapped)).toBe('ECONNREFUSED');
  });

  it('turns anything else into text', () => {
    expect(failureReason('boom')).toBe('boom');
  });
});

describe('runMigrations', () => {
  it('applies what is pending and names each migration by its file', async () => {
    const connection = fakeConnection(MIGRATIONS[0].folderMillis);
    const { log, lines } = recordingLog();

    const ok = await runMigrations(
      { databaseUrl: DATABASE_URL, migrationsFolder: FOLDER },
      depsFor(connection, log),
    );

    expect(ok).toBe(true);
    expect(connection.urls).toEqual([DATABASE_URL]);
    expect(lines[0]).toMatch(/^\[migrate\] applied 0001_/);
    expect(lines.at(-1)).toBe(
      `[migrate] ${MIGRATIONS.length - 1} migration(s) applied`,
    );
    expect(connection.closed).toBe(true);
  });

  it('says so when the database is up to date', async () => {
    const connection = fakeConnection(NEWEST);
    const { log, lines } = recordingLog();

    await runMigrations(
      { databaseUrl: DATABASE_URL, migrationsFolder: FOLDER },
      depsFor(connection, log),
    );

    expect(lines).toEqual([
      '[migrate] nothing to apply — the database is up to date',
    ]);
  });

  it('reports a failure with its reason, and still closes the connection', async () => {
    const connection = fakeConnection(
      null,
      new Error('Failed query', { cause: new Error('permission denied') }),
    );
    const { log, errors } = recordingLog();

    const ok = await runMigrations(
      { databaseUrl: DATABASE_URL, migrationsFolder: FOLDER },
      depsFor(connection, log),
    );

    expect(ok).toBe(false);
    expect(errors).toEqual(['[migrate] FAILED after none: permission denied']);
    expect(connection.closed).toBe(true);
  });
});

describe('migrate (the exit code an entry point hands the process)', () => {
  it('is 0 when every pending migration applied', async () => {
    const { log } = recordingLog();
    const code = await migrate(
      () => ({ databaseUrl: DATABASE_URL, migrationsFolder: FOLDER }),
      depsFor(fakeConnection(null), log),
    );
    expect(code).toBe(0);
  });

  it('is 1 when a migration failed', async () => {
    const { log } = recordingLog();
    const code = await migrate(
      () => ({ databaseUrl: DATABASE_URL, migrationsFolder: FOLDER }),
      depsFor(fakeConnection(null, new Error('refused')), log),
    );
    expect(code).toBe(1);
  });

  // A Job that cannot even read its settings must still fail the sync, and
  // say why, rather than dying on an unhandled rejection.
  it('is 1, with the reason logged, when the settings cannot be read', async () => {
    const { log, errors } = recordingLog();
    const code = await migrate(
      () => migrationSettingsFromEnv({}, REPO_ROOT),
      depsFor(fakeConnection(null), log),
    );
    expect(code).toBe(1);
    expect(errors[0]).toMatch(/^\[migrate\] FAILED: DATABASE_URL is required/);
  });

  it('is 1 when the migrations folder is missing', async () => {
    const { log } = recordingLog();
    const code = await migrate(
      () => ({
        databaseUrl: DATABASE_URL,
        migrationsFolder: migrationsFolder('/nowhere'),
      }),
      depsFor(fakeConnection(null), log),
    );
    expect(code).toBe(1);
  });
});
