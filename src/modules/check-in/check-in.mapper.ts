import type { ScanResultDto } from './dto/check-in.dto';
import type { ScanResult } from './check-in.types';

/** Domain result → the door's response. */
export function toScanResult(result: ScanResult): ScanResultDto {
  return {
    outcome: result.outcome,
    ticketId: result.ticketId,
    holderName: result.holderName,
    ticketLabel: result.ticketLabel,
    checkedInAt: result.checkedInAt?.toISOString() ?? null,
  };
}
