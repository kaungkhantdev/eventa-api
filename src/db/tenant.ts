import { sql } from 'drizzle-orm';
import type { Database } from './drizzle.constants';

/** The Drizzle transaction handle passed to tenant-scoped work. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Run `work` inside a transaction bound to a tenant. Sets the transaction-local
 * `app.current_org` GUC (via set_config(..., true) = SET LOCAL) so Postgres RLS
 * policies scope every statement to this organization, then auto-resets on
 * commit/rollback — safe across a connection pool.
 *
 * Use this for any query that must be tenant-isolated. Pair it with an app role
 * that is subject to RLS (see the 0002 migration) for defence in depth.
 */
export async function withTenant<T>(
  db: Database,
  organizationId: number,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_org', ${String(organizationId)}, true)`,
    );
    return work(tx);
  });
}
