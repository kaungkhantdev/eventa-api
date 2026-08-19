import { Injectable } from '@nestjs/common';
import { SettledFundsPort } from '../payouts/ports/settled-funds.port';
import { PaymentsRepository } from './payments.repository';

/**
 * Payments' implementation of Payouts' `SettledFundsPort`. Payments owns the
 * `payments` and `refunds` ledgers, so the available balance is asked for
 * rather than joined across a context boundary.
 */
@Injectable()
export class SettledFundsAdapter extends SettledFundsPort {
  constructor(private readonly repo: PaymentsRepository) {
    super();
  }

  lifetimeNetSatang(organizationId: number): Promise<number> {
    return this.repo.lifetimeNetTakings(organizationId);
  }
}
