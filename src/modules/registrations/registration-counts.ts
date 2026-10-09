import { orderStatusEnum } from '../../db/schema';
import type {
  RegistrationCounts,
  RegistrationStatus,
} from './registrations.types';

/** One row of the queue's `GROUP BY status`, as the repository selects it. */
export interface StatusTally {
  status: RegistrationStatus;
  count: number;
}

/** The statuses this build is able to publish a field for. */
const PUBLISHED: ReadonlySet<string> = new Set(orderStatusEnum.enumValues);

/**
 * Grouped row counts → the queue's tab totals (US-REG-01).
 *
 * `all` is accumulated from EVERY group rather than by adding up the named
 * buckets beside it, and that is the point. `page()` lists every order the
 * same predicate matches, whatever its status, so a total assembled from a
 * hand-written list of statuses prints a number smaller than the table the
 * moment `order_status` gains a member — which is exactly how the queue came
 * to list expired orders that were in nobody's count. `orders.status` is
 * `notNull`, so every row falls in exactly one group and this sum is the same
 * number a `count(*)` over the same predicate would give.
 *
 * A status outside this build's enum is still counted in `all`, because its
 * rows really are in the list, but is given no field of its own: the breakdown's
 * shape is `RegistrationCountsDto`, the contract `openapi.json` publishes and
 * eventa-web generates from, and a key invented at runtime would make the
 * response disagree with it.
 *
 * Every bucket is seeded from `orderStatusEnum.enumValues` so a tab that
 * matches nothing reads 0 rather than blank — the same reason
 * `TicketingRepository.countsByStatus` seeds its own counts from an enum.
 */
export function tallyByStatus(
  rows: readonly StatusTally[],
): RegistrationCounts {
  const counts = emptyCounts();
  for (const row of rows) {
    counts.all += row.count;
    if (PUBLISHED.has(row.status)) counts[row.status] = row.count;
  }
  return counts;
}

/** Zero for every status, so an empty queue still answers with the whole shape. */
function emptyCounts(): RegistrationCounts {
  const byStatus = Object.fromEntries(
    orderStatusEnum.enumValues.map((status) => [status, 0]),
  ) as Record<RegistrationStatus, number>;
  return { ...byStatus, all: 0 };
}
