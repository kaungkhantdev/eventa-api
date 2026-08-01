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
