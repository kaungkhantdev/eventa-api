import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../auth.types';

/** Injects the authenticated {@link AuthContext} (set by SessionAuthGuard). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { auth?: AuthContext }>();
    if (!req.auth) {
      throw new Error('CurrentAuth used on a route without SessionAuthGuard');
    }
    return req.auth;
  },
);
