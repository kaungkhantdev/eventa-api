import type { AttendanceRowDto } from './dto/attendance.dto';
import type { ScanResultDto } from './dto/check-in.dto';
import type { AttendanceRow, ScanResult } from './check-in.types';

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

/** A roll row → the wire. The date crosses to a string exactly here. */
export function toAttendanceRow(row: AttendanceRow): AttendanceRowDto {
  return {
    ticketId: row.ticketId,
    holderName: row.holderName,
    ticketLabel: row.ticketLabel,
    ticketTypeName: row.ticketTypeName,
    status: row.status,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    method: row.method,
  };
}
