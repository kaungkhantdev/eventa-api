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
import { type AuthContext, SESSION_COOKIE } from '../auth.types';
import { IdentityRepository } from '../identity.repository';

type AuthedRequest = Request & { auth?: AuthContext };

/**
 * Global guard. Public routes pass through; every other route requires a valid
 * session cookie, whose principal + tenant are attached to the request and the
 * request context (so downstream queries scope by organization).
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly repo: IdentityRepository,
    private readonly context: RequestContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const sessionId = cookies[SESSION_COOKIE];
    if (!sessionId) throw this.unauthorized('Authentication required');

    const found = await this.repo.findValidSession(sessionId);
    if (!found) throw this.unauthorized('Session expired or invalid');

    req.auth = { user: found.user, org: found.org, sessionId };
    this.context.set({ organizationId: found.org.id, userId: found.user.id });
    return true;
  }

  private unauthorized(message: string): DomainException {
    return new DomainException(
      ErrorCode.UNAUTHORIZED,
      message,
      HttpStatus.UNAUTHORIZED,
    );
  }
}
