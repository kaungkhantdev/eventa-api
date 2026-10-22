/** The organization module's named constants. */

/** Keys are issued by the server, but they still arrive as input on confirm. */
export const MAX_KEY_LENGTH = 200;

export const MAX_NAME = 200;

export const MAX_DESCRIPTOR = 22;

/** A Thai VAT registration number is exactly 13 digits. */
export const THAI_TAX_ID = /^\d{13}$/;

/** Only http(s) — never a `javascript:`/`data:` URL on a branded surface. */
export const HTTP_URL = /^https?:\/\/[^\s]+$/i;

export const NAME_TAKEN_MESSAGE =
  'That workspace name is already taken. Try another.';
