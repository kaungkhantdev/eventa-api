import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DIGITS = 6;
/** RFC 6238 default: a new code every 30 seconds. */
const PERIOD_SECONDS = 30;
/** Accept the neighbouring steps so a slightly-off clock still works. */
const DRIFT_STEPS = 1;
const SECRET_BYTES = 20; // 160-bit, the RFC 4226 recommendation

/** Encode bytes as RFC 4648 base32 (no padding) — what authenticator apps expect. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue; // tolerate spaces/hyphens users paste in
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh base32 TOTP seed to show as a QR. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** The `otpauth://` URI an authenticator app scans. */
export function totpKeyUri(
  account: string,
  issuer: string,
  secret: string,
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** HOTP (RFC 4226) for one counter step. */
function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The code for `at` (default: now). */
export function generateTotp(secret: string, at: Date = new Date()): string {
  const step = Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);
  return hotp(base32Decode(secret), step);
}

/**
 * Check a code against the current step and one either side, comparing in
 * constant time so a near-miss can't be found by timing.
 */
export function verifyTotp(
  secret: string,
  code: string,
  at: Date = new Date(),
): boolean {
  const candidate = code.replace(/\D/g, '');
  if (candidate.length !== DIGITS) return false;
  const key = base32Decode(secret);
  const step = Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const expected = Buffer.from(hotp(key, step + drift));
    const given = Buffer.from(candidate);
    if (expected.length === given.length && timingSafeEqual(expected, given)) {
      return true;
    }
  }
  return false;
}
