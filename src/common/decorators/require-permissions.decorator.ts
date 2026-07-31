import { SetMetadata } from '@nestjs/common';
import { permissionKeyEnum } from '../../db/schema';

/** A permission key — derived from the schema enum (single source of truth). */
export type PermissionKey = (typeof permissionKeyEnum.enumValues)[number];

/**
 * Named references to every permission key, derived from the schema `pgEnum` —
 * the single source of truth. Use `Permission.evCreate` in guards/controllers
 * instead of a raw `'evCreate'` literal: adding a key to the enum surfaces it
 * here automatically, and a removed/renamed key becomes a compile error at each
 * call site (so nothing is silently missed).
 */
export const Permission = Object.freeze(
  Object.fromEntries(permissionKeyEnum.enumValues.map((key) => [key, key])),
) as { readonly [K in PermissionKey]: K };

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Require the caller's role to grant every listed permission key. Enforced by
 * `PermissionsGuard` server-side (returns 403 if any is missing) — never rely on
 * the UI hiding an action.
 */
export const RequirePermissions = (...keys: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, keys);
