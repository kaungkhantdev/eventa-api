import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { paymentSettings } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { PaymentSetupPort } from '../dashboard/ports/workspace-setup.port';

const CONNECTED = 'connected';

/**
 * Payment settings' answer to "could this workspace take money today"
 * (US-DASH-01).
 *
 * Both halves are required, and for the same reason the charge path requires
 * both: a status of `connected` with no `accountId` is a row that says yes and
 * cannot be charged against. This mirrors the guard in
 * `PaymentSettingsService.disconnect` deliberately — one definition of
 * connected, so the checklist and the till cannot disagree.
 *
 * A workspace with no row at all has not connected. There is nothing to read
 * and nothing to infer.
 */
@Injectable()
export class PaymentSetupAdapter extends PaymentSetupPort {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  async isConnected(organizationId: number): Promise<boolean> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({ connected: sql<boolean>`count(*) > 0` })
        .from(paymentSettings)
        .where(
          and(
            eq(paymentSettings.organizationId, organizationId),
            eq(paymentSettings.status, CONNECTED),
            isNotNull(paymentSettings.accountId),
          ),
        );
      return row.connected;
    });
  }
}
