import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.validation';
import { TokenService } from './token.service';

const config = {
  get: (key: string) => (key === 'JWT_ACCESS_TTL' ? 900 : 604800),
} as unknown as ConfigService<Env, true>;

const subject = {
  userId: 'u1',
  organizationId: 7,
  sessionId: 's1',
  persona: 'admin' as const,
};

describe('TokenService', () => {
  const jwt = new JwtService({ secret: 'test-secret-at-least-16-chars' });
  const tokens = new TokenService(jwt, config);

  it('signs and verifies an access token round-trip', async () => {
    const token = await tokens.signAccess(subject);
    const claims = await tokens.verifyAccess(token);
    expect(claims.sub).toBe('u1');
    expect(claims.org).toBe(7);
    expect(claims.sid).toBe('s1');
    expect(claims.persona).toBe('admin');
    expect(claims.typ).toBe('access');
  });

  it('marks refresh tokens with typ=refresh', async () => {
    const claims = await tokens.verifyRefresh(
      await tokens.signRefresh(subject),
    );
    expect(claims.typ).toBe('refresh');
  });

  it('rejects a token signed with a different secret', async () => {
    const other = new TokenService(
      new JwtService({ secret: 'a-completely-different-secret' }),
      config,
    );
    const foreign = await other.signAccess(subject);
    await expect(tokens.verifyAccess(foreign)).rejects.toBeDefined();
  });
});

/**
 * The claim link a booking's buyer is emailed (US-DISC-15). It is the ONLY
 * proof that whoever creates the account reads that inbox, so it must never be
 * stood in for by any other token this service signs — an access token is
 * handed to the browser, and an invite or reset token names a different
 * person's account entirely.
 */
describe('TokenService booking claim (US-DISC-15)', () => {
  const jwt = new JwtService({ secret: 'test-secret-at-least-16-chars' });
  const tokens = new TokenService(jwt, config);
  const booking = {
    orderId: '0b9c6a52-3f43-4f7e-9d1e-5a0c1f2b7e11',
    email: 'anan@example.test',
  };
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  it('carries the order and the address it was sent to, typed as a booking claim', async () => {
    const { token } = await tokens.signBookingClaim(booking);

    await expect(tokens.verifyBookingClaim(token)).resolves.toMatchObject({
      sub: booking.orderId,
      email: booking.email,
      typ: 'booking_claim',
    });
  });

  it('lasts seven days, and says exactly when it stops working', async () => {
    const before = Date.now();
    const { token, expiresAt } = await tokens.signBookingClaim(booking);

    const { exp } = jwt.decode<{ exp: number }>(token);
    expect(expiresAt.getTime()).toBe(exp * 1000);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + SEVEN_DAYS_MS - 1000,
    );
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + SEVEN_DAYS_MS);
  });

  it.each([
    ['an access token', () => tokens.signAccess(subject)],
    ['a refresh token', () => tokens.signRefresh(subject)],
    [
      'an invite token',
      () =>
        tokens.signInvite({ userId: 'u1', organizationId: 7, membershipId: 3 }),
    ],
    [
      'an email-verification token',
      () => tokens.signEmailVerification({ userId: 'u1', organizationId: 7 }),
    ],
    [
      'an email-change token',
      () =>
        tokens.signEmailChange({
          userId: 'u1',
          organizationId: 7,
          email: booking.email,
        }),
    ],
    [
      'a password-reset token',
      () =>
        tokens.signPasswordReset({
          userId: 'u1',
          organizationId: 7,
          passwordFingerprint: 'pv',
        }),
    ],
    [
      'a two-factor challenge',
      () =>
        tokens.signTwoFactorChallenge({
          userId: 'u1',
          organizationId: 7,
          persona: 'attendee',
          rememberMe: false,
        }),
    ],
  ])('refuses %s, signed with the same secret', async (_name, sign) => {
    const other = await sign();

    await expect(tokens.verifyBookingClaim(other)).rejects.toBeDefined();
  });

  it('refuses a token that only claims to be one but names no address', async () => {
    const forged = await jwt.signAsync({
      sub: booking.orderId,
      typ: 'booking_claim',
    });

    await expect(tokens.verifyBookingClaim(forged)).rejects.toBeDefined();
  });

  it('says when it stops working, as the token itself does', async () => {
    const { token, expiresAt } = await tokens.signBookingClaim(booking);

    const claims = await tokens.verifyBookingClaim(token);

    expect(claims.exp * 1000).toBe(expiresAt.getTime());
  });

  it('refuses a claim that never expires', async () => {
    const forever = await jwt.signAsync({
      sub: booking.orderId,
      email: booking.email,
      typ: 'booking_claim',
    });

    await expect(tokens.verifyBookingClaim(forever)).rejects.toBeDefined();
  });

  it('refuses an expired claim', async () => {
    const expired = await jwt.signAsync({
      sub: booking.orderId,
      email: booking.email,
      typ: 'booking_claim',
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    await expect(tokens.verifyBookingClaim(expired)).rejects.toBeDefined();
  });

  it('refuses a claim signed with a different secret', async () => {
    const foreign = await new TokenService(
      new JwtService({ secret: 'a-completely-different-secret' }),
      config,
    ).signBookingClaim(booking);

    await expect(
      tokens.verifyBookingClaim(foreign.token),
    ).rejects.toBeDefined();
  });
});
