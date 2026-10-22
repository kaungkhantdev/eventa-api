/** The message-deliveries module's named constants. */

export const DEFAULT_PAGE = 1;

export const DEFAULT_LIMIT = 20;

/**
 * How many rows an export carries.
 *
 * A ceiling rather than no limit: US-MSG-07's "very large export" belongs with
 * the prepared-file-and-notification slice, and until that exists a log of a
 * hundred thousand sends is truncated rather than left to time out mid-download.
 */
export const EXPORT_LIMIT = 5000;

export const NOTHING_TO_EXPORT =
  'There is nothing to export — no messages match these filters.';
