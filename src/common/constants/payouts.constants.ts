/** The payouts module's named constants. */

export const MAX_LIMIT = 100;

export const MASK = '••••';

export const VISIBLE_DIGITS = 4;

export const NO_ACCOUNT = 'No bank account';

export const ARRIVAL_NOTE = 'Funds usually arrive within 1–3 business days.';

export const FAILED_NOTE =
  'The transfer could not be completed — check the bank details and retry.';

export const REQUESTED_NOTE = 'Eventa has scheduled this payout to your bank.';

export const PAID_NOTE = 'The money has landed in your account.';

export const AUDIT_TYPE = 'payout' as const;

export const DEFAULT_LIMIT = 20;

export const NOT_FAILED =
  'Only a failed payout can be retried — this one has not failed.';

export const NOT_CONNECTED =
  'Connect a payout account before moving money to your bank.';
