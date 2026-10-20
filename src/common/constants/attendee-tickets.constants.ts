/** The attendee-tickets module's named constants. */

export const CONFIRMED = 'confirmed';

/** A personal portal, not an export: one person's purchases are bounded. */
export const MAX_REGISTRATIONS = 200;

export const TODAY = 'Today';

export const TOMORROW = 'Tomorrow';

/** The printable entry pass's canvas, and the QR's place on it. */
export const TICKET_PASS_WIDTH = 600;

export const TICKET_PASS_HEIGHT = 940;

export const QR_SIZE = 440;

export const QR_X = (TICKET_PASS_WIDTH - QR_SIZE) / 2;

export const QR_Y = 320;
