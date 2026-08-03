import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { organizations } from '../../db/schema';
import { withTenant } from '../../db/tenant';

/** Fallbacks if a workspace row somehow has none — the Thai statutory rate. */
const DEFAULT_VAT_RATE = 0.07;
const DEFAULT_SERVICE_FEE_RATE = 0.05;

/** The two rates that turn a ticket subtotal into what the attendee pays. */
export interface OrgRates {
  vatRate: number;
  serviceFeeRate: number;
}

/** Data access for the checkout. Tenant-scoped; the tenant comes from the event. */
@Injectable()
export class CheckoutRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * VAT and service-fee rates for the workspace selling the ticket. Read at the
   * moment of pricing rather than baked into a constant, so a workspace that
   * negotiated a different fee is charged its own.
   */
  async orgRates(organizationId: number): Promise<OrgRates> {
    return withTenant(this.db, organizationId, async (tx) => {
      const [row] = await tx
        .select({
          vatRate: organizations.vatRate,
          serviceFeeRate: organizations.serviceFeeRate,
        })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return {
        vatRate: row ? Number(row.vatRate) : DEFAULT_VAT_RATE,
        serviceFeeRate: row
          ? Number(row.serviceFeeRate)
          : DEFAULT_SERVICE_FEE_RATE,
      };
    });
  }
}
