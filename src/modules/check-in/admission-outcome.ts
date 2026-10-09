import type { ScanOutcome } from './check-in.types';

/**
 * Which of the two admitting outcomes a single-statement admit landed on
 * (US-REG-12).
 *
 * `CheckInRepository.admit` reports `inserted` from Postgres's own `xmax = 0`:
 * a scan that INSERTED let somebody through the door, and one that collided on
 * `uq_check_ins_ticket` found them already inside. Both the station's reply and
 * the `scan_attempts` row describe that same decision, and they are written in
 * different layers — so the naming lives here once rather than in the service
 * and the repository both, where two copies would be free to drift and the
 * ledger could end up disagreeing with what the door was told.
 */
export function admissionOutcome(inserted: boolean): ScanOutcome {
  return inserted ? 'admitted' : 'already_checked_in';
}
