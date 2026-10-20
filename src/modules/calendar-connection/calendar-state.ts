import { createHash } from 'node:crypto';
import { STATE_PATTERN } from '../../common/constants/calendar-connection.constants';

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
