import { formatBaht } from '../../common/money/baht';
import { canApprove, canReject } from './registration-decision';
import type { RegistrationEntryDto } from './dto/registrations.dto';
import type { RegistrationRow } from './registrations.types';

/**
 * One queue row. Money is MASKED for a caller without finance access — the
 * story is explicit that registrations and revenue are different privileges,
 * and null is the honest representation of "you may not see this", not 0.
 *
 * `canApprove`/`canReject` are decided server-side from the same rules the
 * write path enforces, so the console can never offer an action the API would
 * refuse.
 */
export function toRegistrationEntry(
  row: RegistrationRow,
  canViewMoney: boolean,
): RegistrationEntryDto {
  const approve = canApprove(row);
  const reject = canReject(row);
  return {
    id: row.id,
    reference: row.reference,
    eventId: row.eventId,
    eventName: row.eventName,
    buyerName: row.buyerName,
    buyerEmail: row.buyerEmail,
    status: row.status,
    paymentStatus: row.paymentStatus,
    seats: row.seats,
    totalSatang: canViewMoney ? row.totalSatang : null,
    amountLabel: canViewMoney ? amountLabel(row.totalSatang) : null,
    registeredAt: row.registeredAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    canApprove: approve.allowed,
    approveBlockedReason: approve.reason,
    canReject: reject.allowed,
    rejectBlockedReason: reject.reason,
  };
}

/** A free registration reads "Free", not "฿0" — the story's word, not a price. */
function amountLabel(totalSatang: number): string {
  return totalSatang === 0 ? 'Free' : formatBaht(totalSatang);
}
