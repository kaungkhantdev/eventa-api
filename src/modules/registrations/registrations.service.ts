import { Injectable } from '@nestjs/common';
import { Paginated } from '../../common/http/paginated';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import type { AuthContext } from '../auth/auth.types';
import { PermissionsService } from '../access/permissions.service';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type RegistrationCountsDto,
  type RegistrationEntryDto,
} from './dto/registrations.dto';
import { toRegistrationEntry } from './registrations.mapper';
import { RegistrationsRepository } from './registrations.repository';
import type { RegistrationFilters } from './registrations.types';

export interface ListRegistrationsQuery {
  page?: number;
  limit?: number;
  status?: RegistrationFilters['status'];
  eventId?: string;
  search?: string;
}

/**
 * The registrations queue (US-REG-01): one cross-event, org-wide workbench.
 *
 * Money is masked for a caller without `finView`. Registrations and revenue are
 * separate privileges, so a Staff member reviewing sign-ups sees who and when
 * but not what it was worth — enforced here, server-side, rather than by the
 * console choosing not to render a column.
 */
@Injectable()
export class RegistrationsService {
  constructor(
    private readonly repo: RegistrationsRepository,
    private readonly permissions: PermissionsService,
  ) {}

  async list(
    auth: AuthContext,
    query: ListRegistrationsQuery,
  ): Promise<{
    page: Paginated<RegistrationEntryDto>;
    counts: RegistrationCountsDto;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const filters: RegistrationFilters = { ...query, page, limit };
    // Counts deliberately ignore the status filter: the tabs describe the whole
    // queue, so page 2 of "Pending" still shows how many are Confirmed.
    const countFilters: Omit<RegistrationFilters, 'status'> = {
      page,
      limit,
      eventId: query.eventId,
      search: query.search,
    };
    const [result, counts, canViewMoney] = await Promise.all([
      this.repo.page(auth.organizationId, filters),
      this.repo.countByStatus(auth.organizationId, countFilters),
      this.canViewMoney(auth),
    ]);
    return {
      page: Paginated.of(
        result.items.map((row) => toRegistrationEntry(row, canViewMoney)),
        result.total,
        page,
        limit,
      ),
      counts,
    };
  }

  private async canViewMoney(auth: AuthContext): Promise<boolean> {
    const granted = await this.permissions.getFor(
      auth.organizationId,
      auth.userId,
    );
    return granted.includes(Permission.finView);
  }
}
