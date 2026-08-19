import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainException } from '../errors/domain.exception';
import type { AuthContext } from '../../modules/auth/auth.types';
import {
  ANY_PERMISSION_KEY,
  PERMISSIONS_KEY,
  type PermissionKey,
} from '../decorators/require-permissions.decorator';
import { PermissionsService } from '../../modules/access/permissions.service';

/**
 * Enforces `@RequirePermissions(...)` (every key) and `@RequireAnyPermission(...)`
 * (at least one key) server-side: loads the caller's granted keys and 403s if
 * the route's requirement is not met. Routes with no requirement pass through.
 * Runs after JwtAuthGuard (which sets `req.user`).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const anyOf =
      this.reflector.getAllAndOverride<PermissionKey[]>(ANY_PERMISSION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0 && anyOf.length === 0) return true;

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
    if (anyOf.length > 0 && !anyOf.some((key) => granted.includes(key))) {
      throw DomainException.forbidden(
        `Missing required permission: one of ${anyOf.join(', ')}.`,
      );
    }
    return true;
  }
}
