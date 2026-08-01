import { Injectable } from '@nestjs/common';
import { IdentityRepository } from './identity.repository';

/**
 * Resolves the permission keys a user holds in an org (via their active
 * membership's role). Thin wrapper over the repository — the natural seam for a
 * Redis cache later, so guards never hit the DB on the hot path.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly repo: IdentityRepository) {}

  getFor(organizationId: number, userId: string): Promise<string[]> {
    return this.repo.getPermissions(organizationId, userId);
  }
}
