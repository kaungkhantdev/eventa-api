import type { PayoutStatus } from './payouts.types';
import {
  ARRIVAL_NOTE,
  FAILED_NOTE,
  MASK,
  NO_ACCOUNT,
  PAID_NOTE,
  REQUESTED_NOTE,
  VISIBLE_DIGITS,
} from '../../common/constants/payouts.constants';

/** The three steps a transfer walks through, in order. */
export type TimelineStep = 'requested' | 'processing' | 'paid';

export interface TimelineEntry {
  step: TimelineStep;
  done: boolean;
  /** Plain language — what the organizer should expect, not jargon. */
  note: string | null;
}

/**
 * Show only the last four digits of a destination account (US-FIN-03,
 * US-RPT-07). Eventa never stores a full account number, so this is a display
 * guard for whatever masked descriptor the provider handed us — and it fails
 * CLOSED: a value too short to mask is hidden entirely rather than printed whole.
 *
 * Every descriptor is reduced to its digits, an already-masked one included.
 * The column is free text with no constraint, so a leading mask proves nothing
 * about the rest: `•••• 1234567890` once passed through here whole.
 */
export function maskAccount(descriptor: string | null): string {
  if (!descriptor) return NO_ACCOUNT;
  const digits = descriptor.replace(/\D/g, '');
  if (digits.length < VISIBLE_DIGITS) return `${MASK} ${MASK}`;
  return `${MASK} ${digits.slice(-VISIBLE_DIGITS)}`;
}

/**
 * The plain-language progress of a payout (US-FIN-04). A failed payout does not
 * silently stop at "processing": the step carries why, so the organizer knows
 * there is something to act on rather than something to wait for.
 */
export function payoutTimeline(status: PayoutStatus): TimelineEntry[] {
  const processing = status === 'processing';
  const failed = status === 'failed';
  const paid = status === 'paid';
  return [
    { step: 'requested', done: true, note: REQUESTED_NOTE },
    {
      step: 'processing',
      done: processing || paid || failed,
      note: noteForProcessing(processing, failed),
    },
    { step: 'paid', done: paid, note: paid ? PAID_NOTE : null },
  ];
}

function noteForProcessing(
  processing: boolean,
  failed: boolean,
): string | null {
  if (failed) return FAILED_NOTE;
  return processing ? ARRIVAL_NOTE : null;
}
