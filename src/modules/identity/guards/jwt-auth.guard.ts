import { type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { RequestContextService } from '../../../common/context/request-context';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { DomainException } from '../../../common/errors/domain.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import type { AuthContext } from '../auth.types';

/**
 * Global guard over the `jwt` passport strategy. Public routes pass through;
 * everything else requires a valid Bearer access token. On success the resolved
 * principal is stamped onto the request context (organizationId/userId) for
 * tenant scoping; failures render as the standard 401 envelope.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
  ) {
    super();
  }

  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(ctx);
  }

  handleRequest<TUser = AuthContext>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw new DomainException(
        ErrorCode.UNAUTHORIZED,
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const auth = user as unknown as AuthContext;
    this.context.set({
      organizationId: auth.organizationId,
      userId: auth.userId,
    });
    return user;
  }
}
