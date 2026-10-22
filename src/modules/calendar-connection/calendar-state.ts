import { createHash } from 'node:crypto';
import { STATE_PATTERN } from '../../common/constants/calendar-connection.constants';

/**
 * `<workspace id>.<43-character base64url nonce>` — the whole `state` Google
 * echoes back to the callback, and nothing else.
 *
 * Opaque on purpose (US-MTG-08, NFR-PDPA-04): it carries no user id, email or
 * token. It is not a JWT either, because this API's email-verification,
 * email-change and password-reset verifiers accept any HS256 token without
 * checking `typ`, so a URL-borne token carrying `sub` and `org` would also
 * pass as one of those. The workspace id only says WHICH row to look in; the
 * hash of the nonce stored on that row is what proves the state is ours.
 */

export interface ParsedState {
  organizationId: number;
  nonce: string;
}

export function formatState(organizationId: number, nonce: string): string {
  return `${organizationId}.${nonce}`;
}

/**
 * Null for anything that is not exactly one well-formed state — including a
 * repeated query parameter, which Express parses into an array.
 */
export function parseState(raw: unknown): ParsedState | null {
  if (typeof raw !== 'string') return null;
  const match = STATE_PATTERN.exec(raw);
  if (!match) return null;
  const organizationId = Number(match[1]);
  if (!Number.isSafeInteger(organizationId)) return null;
  return { organizationId, nonce: match[2] };
}

/** What the database stores in place of a nonce. */
export function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
