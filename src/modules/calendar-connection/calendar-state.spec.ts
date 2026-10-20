import { createHash, randomBytes } from 'node:crypto';
import {
  STATE_PATTERN,
  formatState,
  parseState,
  sha256hex,
} from './calendar-state';

const NONCE = randomBytes(32).toString('base64url');

describe('calendar connect state (US-MTG-08)', () => {
  it('uses a 43-character base64url nonce', () => {
    expect(NONCE).toHaveLength(43);
    expect(STATE_PATTERN.test(`7.${NONCE}`)).toBe(true);
  });

  it('round-trips the workspace and the nonce', () => {
    expect(parseState(formatState(42, NONCE))).toEqual({
      organizationId: 42,
      nonce: NONCE,
    });
  });

  it('carries nothing but the workspace id and the nonce', () => {
    expect(formatState(42, NONCE)).toBe(`42.${NONCE}`);
  });

  it.each([
    ['no dot', `42${NONCE}`],
    ['workspace 0', `0.${NONCE}`],
    ['a leading zero', `042.${NONCE}`],
    ['an over-long workspace id', `12345678901234567.${NONCE}`],
    ['a workspace id past the safe integers', `9999999999999999.${NONCE}`],
    ['a short nonce', `42.${NONCE.slice(1)}`],
    ['a long nonce', `42.${NONCE}A`],
    ['a nonce outside base64url', `42.${NONCE.slice(1)}+`],
    ['padding', `42.${NONCE.slice(1)}=`],
    ['a negative workspace', `-42.${NONCE}`],
    ['surrounding text', ` 42.${NONCE}`],
    ['an empty string', ''],
  ])('refuses %s', (_label, raw) => {
    expect(parseState(raw)).toBeNull();
  });

  it.each([
    ['an array (a repeated query parameter)', [`42.${NONCE}`, `43.${NONCE}`]],
    ['an object', { state: `42.${NONCE}` }],
    ['undefined', undefined],
    ['a number', 42],
  ])('refuses %s', (_label, raw) => {
    expect(parseState(raw)).toBeNull();
  });

  it('hashes with SHA-256 as lowercase hex', () => {
    expect(sha256hex('abc')).toBe(
      createHash('sha256').update('abc').digest('hex'),
    );
    expect(sha256hex('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
