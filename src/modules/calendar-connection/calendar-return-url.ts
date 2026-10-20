import { INTEGRATIONS_PATH } from '../../common/constants/calendar-connection.constants';
/** How a connect attempt ended, as the web's toast reads it (US-MTG-08). */
export type ConnectOutcome = 'connected' | 'denied' | 'failed';

const OUTCOMES: ReadonlySet<string> = new Set<ConnectOutcome>([
  'connected',
  'denied',
  'failed',
]);

/**
 * Where the callback sends the browser back to: PUBLIC_WEB_URL, a fixed path
 * and one word. Never built from the query, the state or the Referer, so the
 * callback cannot be turned into an open redirect, and the URL carries no
 * personal data (NFR-PDPA-04).
 */
export function settingsReturnUrl(
  publicWebUrl: string,
  outcome: ConnectOutcome,
): string {
  if (!OUTCOMES.has(outcome)) {
    throw new Error('Unknown calendar connect outcome.');
  }
  return `${publicWebUrl.replace(/\/+$/, '')}${INTEGRATIONS_PATH}?calendar=${outcome}`;
}
