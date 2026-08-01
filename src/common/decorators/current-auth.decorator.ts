import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../../modules/auth/auth.types';

/** Injects the authenticated {@link AuthContext} (set on req.user by the jwt strategy). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthContext }>();
    if (!req.user) {
      throw new Error('CurrentAuth used on a route without JwtAuthGuard');
    }
    return req.user;
  },
);
