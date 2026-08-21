import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { paymentCredentials } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type {
  PaymentCredentialsRow,
  PaymentMode,
} from './payment-settings.types';

/** What a save writes. Absent ciphers mean "leave what is already stored". */
export interface SaveCredentialsInput {
  publishableKey: string;
  secretKeyCipher: Buffer;
  webhookSecretCipher?: Buffer | null;
  savedAt: Date;
}

/**
 * Data access for a workspace's own Stripe keys, one row per mode.
 *
 * Every method is tenant-scoped through `withTenant`, so RLS is the second line
 * behind an explicit `organization_id` — which matters more here than anywhere
 * else in the schema, because the rows hold encrypted secrets.
 */
@Injectable()
export class PaymentCredentialsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async find(
    organizationId: number,
    mode: PaymentMode,
  ): Promise<PaymentCredentialsRow | null> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(paymentCredentials)
        .where(
          and(
            eq(paymentCredentials.organizationId, organizationId),
            eq(paymentCredentials.mode, mode),
          ),
        )
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * Upsert this mode's pair, leaving the OTHER mode untouched — that separation
   * is the whole reason the table is keyed by mode.
   *
   * A webhook secret of `undefined` is not "clear it": an organizer re-pasting
   * their API keys has not necessarily re-fetched the signing secret, and
   * silently blanking it would stop every order settling.
   */
  async save(
    organizationId: number,
    mode: PaymentMode,
    input: SaveCredentialsInput,
  ): Promise<PaymentCredentialsRow> {
    const webhook =
      input.webhookSecretCipher === undefined
        ? {}
        : { webhookSecretCipher: input.webhookSecretCipher };
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(paymentCredentials)
        .values({
          organizationId,
          mode,
          publishableKey: input.publishableKey,
          secretKeyCipher: input.secretKeyCipher,
          savedAt: input.savedAt,
          ...webhook,
        })
        .onConflictDoUpdate({
          target: [
            paymentCredentials.organizationId,
            paymentCredentials.mode,
          ],
          set: {
            publishableKey: input.publishableKey,
            secretKeyCipher: input.secretKeyCipher,
            savedAt: input.savedAt,
            updatedAt: input.savedAt,
            ...webhook,
          },
        })
        .returning();
      return row;
    });
  }

  /**
   * Forget both modes' keys. Disconnecting is the organizer saying "stop using
   * my Stripe" — keeping the secrets after that would be holding a credential
   * we were told to stop holding.
   */
  async deleteAll(organizationId: number): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .delete(paymentCredentials)
        .where(eq(paymentCredentials.organizationId, organizationId));
    });
  }
}
