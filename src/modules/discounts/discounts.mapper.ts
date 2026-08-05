import { DiscountResponseDto } from './dto/discount-response.dto';
import type { DiscountRow, DiscountSnapshot } from './discounts.types';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The subset of a row the rules judge — keeps the policy free of storage types. */
export function toSnapshot(
  row: DiscountSnapshot | DiscountRow,
): DiscountSnapshot {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    status: row.status,
    eventId: row.eventId,
    used: row.used,
    redemptionLimit: row.redemptionLimit,
    perPersonLimit: row.perPersonLimit,
    minOrderSatang: row.minOrderSatang,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
  };
}

export function toDiscountResponse(row: DiscountRow): DiscountResponseDto {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    status: row.status,
    eventId: row.eventId,
    scope: row.eventId === null ? 'all_events' : 'event',
    used: row.used,
    redemptionLimit: row.redemptionLimit,
    perPersonLimit: row.perPersonLimit,
    minOrderSatang: row.minOrderSatang,
    validFrom: iso(row.validFrom),
    validUntil: iso(row.validUntil),
    version: row.version,
  };
}
