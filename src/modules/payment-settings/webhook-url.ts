import { WEBHOOK_PATH } from '../../common/constants/payment-settings.constants';

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
