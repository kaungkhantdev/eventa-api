import {
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { RequestContextService } from '../context/request-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { DomainException } from '../errors/domain.exception';
import { ErrorCode } from '../errors/error-codes';
import type { AuthContext } from '../../modules/auth/auth.types';

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
    // Checking a token reads its session (JwtStrategy). A read that fails — the
    // database is unreachable — has not judged the token: a 401 would tell the
    // client its session is over and the client would end it, so it surfaces
    // as the server error it is. A refused token arrives as an HttpException.
    if (err instanceof Error && !(err instanceof HttpException)) throw err;
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
