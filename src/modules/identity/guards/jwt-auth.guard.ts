import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContextService } from '../../../common/context/request-context';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { DomainException } from '../../../common/errors/domain.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { AccessTokenClaims, AuthContext } from '../auth.types';
import { TokenService } from '../token.service';

type AuthedRequest = Request & { auth?: AuthContext };

/**
 * Global guard. Public routes pass through; every other route requires a valid
 * Bearer access token. Verification is stateless (no DB) — the token's claims
 * populate the request + request context (organizationId/userId) for tenant
 * scoping. Revocation is handled at refresh time via the auth_sessions row.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly context: RequestContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = this.bearerToken(req.headers.authorization);
    if (!token) throw this.unauthorized('Authentication required');

    let claims: AccessTokenClaims;
    try {
      claims = await this.tokens.verifyAccess(token);
    } catch {
      throw this.unauthorized('Invalid or expired token');
    }
    if (claims.typ !== 'access') throw this.unauthorized('Invalid token type');

    req.auth = {
      userId: claims.sub,
      organizationId: claims.org,
      sessionId: claims.sid,
      persona: claims.persona,
    };
    this.context.set({ organizationId: claims.org, userId: claims.sub });
    return true;
  }

  private bearerToken(header: string | undefined): string | null {
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7).trim() || null;
  }

  private unauthorized(message: string): DomainException {
    return new DomainException(
      ErrorCode.UNAUTHORIZED,
      message,
      HttpStatus.UNAUTHORIZED,
    );
  }
}
