import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { notificationReads } from '../../db/schema';
import { withTenant } from '../../db/tenant';

/**
 * One member's feed watermark (US-MSG-03).
 *
 * The only thing this module stores. The feed itself is derived, so "read" is a
 * single instant per member rather than a flag per item.
 */
@Injectable()
export class NotificationReadsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Null when this member has never marked their feed read. */
  async readAtFor(
    organizationId: number,
    userId: string,
  ): Promise<Date | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ readAt: notificationReads.readAt })
        .from(notificationReads)
        .where(
          and(
            eq(notificationReads.organizationId, organizationId),
            eq(notificationReads.userId, userId),
          ),
        );
      return row?.readAt ?? null;
    });
  }

  /**
   * Move the watermark forward.
   *
   * An upsert rather than an insert-or-update dance: the row may not exist yet,
   * and two tabs marking read at once must not collide on the unique key.
   */
  async markReadAt(
    organizationId: number,
    userId: string,
    readAt: Date,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .insert(notificationReads)
        .values({ organizationId, userId, readAt })
        .onConflictDoUpdate({
          target: [notificationReads.organizationId, notificationReads.userId],
          set: { readAt, updatedAt: new Date() },
        });
    });
  }
}
