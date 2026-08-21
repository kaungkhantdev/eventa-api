/**
 * Where this service listens, matching `setGlobalPrefix` in `main.ts` and the
 * route on `PaymentsController`. Named once here because an organizer pastes
 * the result into Stripe by hand: if it drifts from the mapped route, the
 * callback 404s and orders stop settling with nothing on screen to say so.
 */
const WEBHOOK_PATH = '/api/v1/public/payments/webhook';

/**
 * This workspace's own webhook URL (US-SET-08).
 *
 * Null until a token exists — which is until the first key save. Showing a
 * half-formed URL would invite somebody to register an endpoint that can never
 * resolve, and they would only find out when a real buyer paid.
 */
export function webhookUrlFor(
  publicApiUrl: string,
  token: string | null,
): string | null {
  if (!token) return null;
  return `${publicApiUrl.replace(/\/+$/, '')}${WEBHOOK_PATH}/${token}`;
}
