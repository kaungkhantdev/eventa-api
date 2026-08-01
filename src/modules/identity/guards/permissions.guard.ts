import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainException } from '../../../common/errors/domain.exception';
import type { AuthContext } from '../auth.types';
import {
  PERMISSIONS_KEY,
  type PermissionKey,
} from '../decorators/require-permissions.decorator';
import { PermissionsService } from '../permissions.service';

/**
 * Enforces `@RequirePermissions(...)` server-side: loads the caller's granted
 * keys and 403s if any required key is missing. Routes with no requirement pass
 * through. Runs after JwtAuthGuard (which sets `req.user`).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthContext }>();
    const auth = req.user;
    if (!auth) throw DomainException.forbidden('Not authenticated.');

    const granted = await this.permissions.getFor(
      auth.organizationId,
      auth.userId,
    );
    const missing = required.filter((key) => !granted.includes(key));
    if (missing.length > 0) {
      throw DomainException.forbidden(
        `Missing required permission: ${missing.join(', ')}.`,
      );
    }
    return true;
  }
}
