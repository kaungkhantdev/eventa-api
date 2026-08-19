import { formatBaht } from '../../common/money/baht';
import type {
  BalancesDto,
  PayoutDetailDto,
  PayoutEntryDto,
} from './dto/payouts.dto';
import { maskAccount, payoutTimeline } from './payout-timeline';
import type { Balances, PayoutRow } from './payouts.types';

/** One row of the payout history — destination always masked (US-FIN-03). */
export function toPayoutEntry(row: PayoutRow): PayoutEntryDto {
  return {
    reference: row.reference,
    amountSatang: row.amountSatang,
    amountLabel: formatBaht(row.amountSatang),
    currency: row.currency,
    bankAccount: maskAccount(row.bankAccount),
    status: row.status,
    periodCovered: row.periodCovered,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    // Server-side, so the console never offers a retry the API would refuse.
    canRetry: row.status === 'failed',
  };
}

export function toPayoutDetail(row: PayoutRow): PayoutDetailDto {
  return {
    ...toPayoutEntry(row),
    timeline: payoutTimeline(row.status),
    canDownloadReceipt: row.status === 'paid' && row.completedAt !== null,
  };
}

export function toBalances(balances: Balances): BalancesDto {
  return {
    ...balances,
    availableLabel: label(balances.availableSatang),
    pendingLabel: label(balances.pendingSatang),
    paidOutLabel: label(balances.paidOutSatang),
  };
}

/** Null stays null: an unconnected workspace has no figure, not ฿0. */
function label(satang: number | null): string | null {
  return satang === null ? null : formatBaht(satang);
}
