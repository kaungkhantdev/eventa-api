import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../config/env.validation';
import { AuthRepository } from './auth.repository';
import type { AccessTokenClaims, AuthContext } from './auth.types';

/**
 * Verifies the Bearer access JWT (signature + expiry), then that the session it
 * was issued under is still live, and turns its claims into the request
 * principal.
 *
 * The session read is what makes a revocation bite at once. Signing a device
 * out (US-ACC-09), a password reset (US-ACC-04) and deleting the account
 * (NFR-PDPA-03) all revoke the auth_sessions row, and each promises the access
 * ends then — a stateless check left every token already issued working until
 * it expired.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly repo: AuthRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  async validate(payload: AccessTokenClaims): Promise<AuthContext> {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    if (!(await this.repo.isSessionLive(payload.org, payload.sid))) {
      throw new UnauthorizedException('Session expired or revoked');
    }
    return {
      userId: payload.sub,
      organizationId: payload.org,
      sessionId: payload.sid,
      persona: payload.persona,
    };
  }
}
