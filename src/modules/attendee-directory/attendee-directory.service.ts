import { Injectable } from '@nestjs/common';
import { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { AttendeeDirectoryRepository } from './attendee-directory.repository';
import { toAttendeeEntry } from './attendee-directory.mapper';
import type {
  DirectoryFilters,
  SegmentCounts,
} from './attendee-directory.types';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type AttendeeEntryDto,
} from './dto/directory.dto';

export type ListAttendeesQuery = Partial<DirectoryFilters>;

/**
 * The attendee directory (US-REG-05): who is coming, across every event.
 *
 * Segment counts are computed WITHOUT the segment filter, so the tabs describe
 * the whole directory rather than the slice currently shown — the same rule the
 * finance and registrations ledgers follow.
 */
@Injectable()
export class AttendeeDirectoryService {
  constructor(private readonly repo: AttendeeDirectoryRepository) {}

  async list(
    auth: AuthContext,
    query: ListAttendeesQuery,
  ): Promise<{
    page: Paginated<AttendeeEntryDto>;
    counts: SegmentCounts;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const filters: DirectoryFilters = { ...query, page, limit };
    const [result, counts] = await Promise.all([
      this.repo.page(auth.organizationId, filters),
      this.repo.counts(auth.organizationId, {
        page,
        limit,
        tag: query.tag,
        search: query.search,
        sort: query.sort,
      }),
    ]);
    return {
      page: Paginated.of(
        result.items.map(toAttendeeEntry),
        result.total,
        page,
        limit,
      ),
      counts,
    };
  }
}
