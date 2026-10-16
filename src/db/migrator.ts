import { sql } from 'drizzle-orm';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * Applying migrations ONE TRANSACTION AT A TIME — what `pnpm migrate` runs.
 *
 * `drizzle-kit migrate` applies every pending migration in a single
 * transaction, and Postgres refuses to use an enum value in the transaction
 * that added it ("unsafe use of new value"). So a migration that USES a value
 * an earlier migration added works on a database migrated in small batches and
 * fails on a fresh one, where everything is one batch: 0052 uses permission
 * keys that 0034, 0038 and 0042 add, and `drizzle-kit migrate` against an empty
 * database rolled the whole schema back. Committing after each migration is
 * what makes the order of the files enough — a CI database, a new developer's
 * and a first deploy are all fresh.
 *
 * The bookkeeping is drizzle's own — the same journal table, hash and
 * `created_at` — so a database that drizzle-kit migrated carries on here, and
 * the other way round.
 */

/** Where drizzle records what has been applied. */
export const MIGRATIONS_JOURNAL = {
  schema: 'drizzle',
  table: '__drizzle_migrations',
} as const;

/** What applying needs from a database, so the order can be tested without one. */
export interface MigrationTarget {
  /** Create the journal if this database has never been migrated. */
  prepare(): Promise<void>;
  /** `created_at` of the newest migration applied; null on a fresh database. */
  lastAppliedAt(): Promise<number | null>;
  /** One migration and its journal row, committed together or not at all. */
  applyOne(migration: MigrationMeta): Promise<void>;
}

/**
 * Apply what is pending, each migration in its own transaction, in journal
 * order. Pending is drizzle's rule: newer than the newest one applied.
 *
 * Stops at the first failure. Everything before it stays committed and
 * recorded, so fixing the failing migration and running again resumes there
 * rather than from an empty schema. Returns how many were applied.
 */
export async function migrateEach(
  target: MigrationTarget,
  migrations: MigrationMeta[],
  onApplied: (migration: MigrationMeta) => void = () => undefined,
): Promise<number> {
  await target.prepare();
  const last = await target.lastAppliedAt();
  const pending =
    last === null
      ? migrations
      : migrations.filter((migration) => migration.folderMillis > last);
  for (const migration of pending) {
    await target.applyOne(migration);
    onApplied(migration);
  }
  return pending.length;
}

/** The real target: drizzle's journal, and one transaction per migration. */
export function drizzleTarget<T extends Record<string, unknown>>(
  db: NodePgDatabase<T>,
): MigrationTarget {
  const schema = sql.identifier(MIGRATIONS_JOURNAL.schema);
  const journal = sql`${schema}.${sql.identifier(MIGRATIONS_JOURNAL.table)}`;
  return {
    async prepare() {
      // drizzle's own DDL, so either tool finds the table the other made.
      await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${journal} (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `);
    },
    async lastAppliedAt() {
      const result = await db.execute<{ created_at: string | null }>(
        sql`SELECT max(created_at) AS created_at FROM ${journal}`,
      );
      const value = result.rows[0]?.created_at;
      return value === null || value === undefined ? null : Number(value);
    },
    async applyOne(migration) {
      await db.transaction(async (tx) => {
        // Each `--> statement-breakpoint` chunk as drizzle sends it.
        for (const statement of migration.sql) {
          await tx.execute(sql.raw(statement));
        }
        await tx.execute(
          sql`INSERT INTO ${journal} ("hash", "created_at")
              VALUES (${migration.hash}, ${migration.folderMillis})`,
        );
      });
    },
  };
}
