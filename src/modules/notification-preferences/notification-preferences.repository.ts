import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { notificationPreferences } from '../../db/schema';
import { withTenant } from '../../db/tenant';

export type PreferenceRow = typeof notificationPreferences.$inferSelect;
export type NotificationCategory = PreferenceRow['category'];

/** Data access for a member's per-topic email/SMS toggles. */
@Injectable()
export class NotificationPreferencesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  list(organizationId: number, userId: string): Promise<PreferenceRow[]> {
    return withTenant(this.db, organizationId, (tx) =>
      tx
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.organizationId, organizationId),
            eq(notificationPreferences.userId, userId),
          ),
        ),
    );
  }

  /** Upsert one topic's toggles (absent row = the defaults). */
  async set(
    organizationId: number,
    userId: string,
    category: NotificationCategory,
    values: { emailEnabled?: boolean; smsEnabled?: boolean },
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .insert(notificationPreferences)
        .values({ organizationId, userId, category, ...values })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.userId,
            notificationPreferences.category,
          ],
          set: { ...values, updatedAt: new Date() },
        });
    });
  }
}
