import { Injectable } from '@nestjs/common';
import { AccessRepository } from './access.repository';

/**
 * Keeps a workspace's BUILT-IN roles in step with the permission catalog.
 *
 * Separate from `PermissionsService`, which answers "what does this caller
 * hold" and is the natural seam for a cache: resolving a caller's access and
 * repairing a workspace's roles are different jobs with different callers, and
 * putting a write behind the guards' read would poison the hot path.
 *
 * Kept deliberately thin — callers outside this module depend on the access
 * module's abstraction rather than reaching for its repository.
 */
@Injectable()
export class SystemRolesService {
  constructor(private readonly repo: AccessRepository) {}

  reconcile(organizationId: number): Promise<void> {
    return this.repo.reconcileSystemRoles(organizationId);
  }
}
