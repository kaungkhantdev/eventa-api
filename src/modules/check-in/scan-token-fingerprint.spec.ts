import { fingerprintScanToken } from './scan-token-fingerprint';

/** A token shaped like the real thing — `generateQrToken` mints 24 of these. */
const TOKEN = 'K7M2Q9XW4RT8V3NP6JHY5CBD';

describe('fingerprintScanToken (the `scan_attempts` token rule)', () => {
  it('never contains the token it was given', () => {
    // The whole point: the ledger is append-only, outlives the ticket and is
    // read by anyone who may review the door, so it must not hold a credential
    // that still opens it.
    expect(fingerprintScanToken(TOKEN)).not.toContain(TOKEN);
  });

  it('gives the same code the same fingerprint every time, so repeats group', () => {
    // "One broken pass presented forty times" vs "forty different bad codes"
    // is a GROUP BY on this value, and it only works if it is deterministic.
    expect(fingerprintScanToken(TOKEN)).toBe(fingerprintScanToken(TOKEN));
  });

  it('gives two different codes two different fingerprints', () => {
    expect(fingerprintScanToken(TOKEN)).not.toBe(
      fingerprintScanToken('ZZZZQ9XW4RT8V3NP6JHY5CBD'),
    );
  });

  it('is the FULL digest, not a truncation — a shortened one would merge codes', () => {
    // `passwordFingerprint` truncates because it only has to match one hash;
    // this value is a grouping key across a night's scans, where a collision
    // would fuse two unrelated bad codes into one "repeatedly refused" story.
    expect(fingerprintScanToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the same length whatever it was given, so the log leaks no code length', () => {
    expect(fingerprintScanToken('x')).toHaveLength(
      fingerprintScanToken('x'.repeat(256)).length,
    );
  });
});
