/** Where an attendee opens an order's tickets on the public site. */
const TICKETS_PATH = '/my/tickets/orders';

/**
 * The ABSOLUTE link the confirmation email points at. Built here, from
 * `PUBLIC_WEB_URL`, for the same reason `verifyUrl` and `resetUrl` are: the
 * worker has no notion of the web origin, and a root-relative path is inert in
 * an email client — there is no document to resolve it against.
 */
export function ticketsUrlFor(publicWebUrl: string, orderId: string): string {
  return `${publicWebUrl}${TICKETS_PATH}/${orderId}`;
}
