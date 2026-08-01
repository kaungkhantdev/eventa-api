import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../config/env.validation';
import type { AccessTokenClaims, AuthContext } from './auth.types';

/**
 * Verifies the Bearer access JWT (signature + expiry) and turns its claims into
 * the request principal. Stateless — no DB hit; revocation is enforced at refresh
 * time via the auth_sessions row.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  validate(payload: AccessTokenClaims): AuthContext {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    return {
      userId: payload.sub,
      organizationId: payload.org,
      sessionId: payload.sid,
      persona: payload.persona,
    };
  }
}
