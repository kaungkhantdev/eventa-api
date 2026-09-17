import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { paymentMethodSettings, paymentSettings } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  PaymentMethod,
  PaymentMethodSettingRow,
  PaymentSettingsRow,
} from './payment-settings.types';

/** Data access for a workspace's payment connection, methods and preferences. */
@Injectable()
export class PaymentSettingsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The org's settings row, created with defaults on first read. */
  async findOrCreate(organizationId: number): Promise<PaymentSettingsRow> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.organizationId, organizationId))
        .limit(1);
      if (existing) return existing;
      const [created] = await tx
        .insert(paymentSettings)
        .values({ organizationId })
        .onConflictDoNothing({ target: paymentSettings.organizationId })
        .returning();
      if (created) return created;
      // Lost the race — the concurrent insert's row is now visible.
      const [row] = await tx
        .select()
        .from(paymentSettings)
        .where(eq(paymentSettings.organizationId, organizationId))
        .limit(1);
      return row;
    });
  }

  /**
   * The workspace a webhook URL's token belongs to.
   *
   * Deliberately a GLOBAL lookup, outside `withTenant`: a callback from Stripe
   * carries no session and no tenant. The token in its URL is what resolves
   * one — exactly as a gateway reference does for an anonymous buyer's payment.
   */
  async findByWebhookToken(token: string): Promise<PaymentSettingsRow | null> {
    const [row] = await this.db
      .select()
      .from(paymentSettings)
      .where(eq(paymentSettings.webhookToken, token))
      .limit(1);
    return row ?? null;
  }

  async update(
    organizationId: number,
    values: Partial<PaymentSettingsRow>,
  ): Promise<PaymentSettingsRow> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .update(paymentSettings)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(paymentSettings.organizationId, organizationId))
        .returning();
      return row;
    });
  }

  listMethods(organizationId: number): Promise<PaymentMethodSettingRow[]> {
    return withTenant(this.db, organizationId, (tx) =>
      tx
        .select()
        .from(paymentMethodSettings)
        .where(eq(paymentMethodSettings.organizationId, organizationId))
        .orderBy(asc(paymentMethodSettings.method)),
    );
  }

  /** Enable/disable one method (upsert — an absent row means disabled). */
  async setMethod(
    organizationId: number,
    method: PaymentMethod,
    enabled: boolean,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .insert(paymentMethodSettings)
        .values({ organizationId, method, enabled })
        .onConflictDoUpdate({
          target: [
            paymentMethodSettings.organizationId,
            paymentMethodSettings.method,
          ],
          set: { enabled, updatedAt: new Date() },
        });
    });
  }

  async countEnabledMethods(organizationId: number): Promise<number> {
    const rows = await withTenant(this.db, organizationId, (tx) =>
      tx
        .select({ method: paymentMethodSettings.method })
        .from(paymentMethodSettings)
        .where(
          and(
            eq(paymentMethodSettings.organizationId, organizationId),
            eq(paymentMethodSettings.enabled, true),
          ),
        ),
    );
    return rows.length;
  }
}
