import { Injectable } from '@nestjs/common';
import { TaxableSalesPort } from '../tax-periods/ports/taxable-sales.port';
import type { MonthlyTakings } from '../tax-periods/tax-periods.types';
import { PaymentsRepository } from './payments.repository';

/**
 * Payments' implementation of the VAT ledger's `TaxableSalesPort`. Payments owns
 * the `payments` and `refunds` ledgers, so the tax module asks what was
 * collected rather than reading those tables itself.
 */
@Injectable()
export class TaxableSalesAdapter extends TaxableSalesPort {
  constructor(private readonly repo: PaymentsRepository) {
    super();
  }

  totalsByMonth(
    organizationId: number,
    year: number,
  ): Promise<MonthlyTakings[]> {
    return this.repo.takingsByMonth(organizationId, year);
  }
}
