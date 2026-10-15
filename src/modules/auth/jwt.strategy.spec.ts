import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import type { AuthRepository } from './auth.repository';
import type { AccessTokenClaims } from './auth.types';
import { JwtStrategy } from './jwt.strategy';

const config = {
  get: () => 'test-secret-at-least-16-characters-long',
} as unknown as ConfigService<Env, true>;

const claims: AccessTokenClaims = {
  sub: 'u1',
  org: 7,
  sid: 's1',
  persona: 'attendee',
  typ: 'access',
};

/**
 * A signature and an expiry prove a token was issued, not that the session it
 * was issued for still stands. Signing out another device (US-ACC-09), a
 * password reset (US-ACC-04) and deleting the account (NFR-PDPA-03) all end
 * sessions, and each promises the access goes with them — at once, not when
 * the token happens to lapse.
 */
describe('JwtStrategy', () => {
  let repo: jest.Mocked<Pick<AuthRepository, 'isSessionLive'>>;
  let strategy: JwtStrategy;

  beforeEach(() => {
    repo = { isSessionLive: jest.fn().mockResolvedValue(true) };
    strategy = new JwtStrategy(config, repo as unknown as AuthRepository);
  });

  it('turns the claims of a live session into the principal', async () => {
    await expect(strategy.validate(claims)).resolves.toEqual({
      userId: 'u1',
      organizationId: 7,
      sessionId: 's1',
      persona: 'attendee',
    });
    expect(repo.isSessionLive).toHaveBeenCalledWith(7, 's1');
  });

  it('refuses a token whose session was signed out, reset away or deleted', async () => {
    repo.isSessionLive.mockResolvedValue(false);

    await expect(strategy.validate(claims)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refuses a token that is not an access token, without looking it up', async () => {
    const refresh = {
      ...claims,
      typ: 'refresh',
    } as unknown as AccessTokenClaims;

    await expect(strategy.validate(refresh)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repo.isSessionLive).not.toHaveBeenCalled();
  });
});
