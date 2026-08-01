import {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  totpKeyUri,
  verifyTotp,
} from './totp';

describe('TOTP (RFC 6238)', () => {
  const secret = generateTotpSecret();

  it('round-trips base32', () => {
    const bytes = Buffer.from('hello world!');
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('matches the RFC 4226 test vector', () => {
    // RFC 4226 Appendix D: secret "12345678901234567890", counter 0 → 755224.
    const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));
    expect(generateTotp(rfcSecret, new Date(0))).toBe('755224');
  });

  it('accepts the current code', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    expect(verifyTotp(secret, generateTotp(secret, now), now)).toBe(true);
  });

  it('tolerates one step of clock drift either way', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const earlier = new Date(now.getTime() - 30_000);
    const later = new Date(now.getTime() + 30_000);
    expect(verifyTotp(secret, generateTotp(secret, earlier), now)).toBe(true);
    expect(verifyTotp(secret, generateTotp(secret, later), now)).toBe(true);
  });

  it('rejects a code from far outside the window', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const stale = new Date(now.getTime() - 10 * 60_000);
    expect(verifyTotp(secret, generateTotp(secret, stale), now)).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyTotp(secret, 'abc')).toBe(false);
    expect(verifyTotp(secret, '')).toBe(false);
  });

  it('builds an otpauth URI an app can scan', () => {
    const uri = totpKeyUri('a@acme.test', 'Eventa', secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\/Eventa%3Aa%40acme\.test\?/);
    expect(uri).toContain(`secret=${secret}`);
  });
});
