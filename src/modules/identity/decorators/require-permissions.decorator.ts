import { SetMetadata } from '@nestjs/common';
import { permissionKeyEnum } from '../../../db/schema';

/** A permission key — derived from the schema enum (single source of truth). */
export type PermissionKey = (typeof permissionKeyEnum.enumValues)[number];

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Require the caller's role to grant every listed permission key. Enforced by
 * `PermissionsGuard` server-side (returns 403 if any is missing) — never rely on
 * the UI hiding an action.
 */
export const RequirePermissions = (...keys: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, keys);
