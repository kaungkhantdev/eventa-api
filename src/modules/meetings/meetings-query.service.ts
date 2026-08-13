import { Injectable } from '@nestjs/common';
import { Paginated } from '../../common/http/paginated';
import { Clock } from '../../common/time/clock';
import type { AuthContext } from '../auth/auth.types';
import type { MeetingBucket } from './meeting-bucket';
import { toMeetingEntry } from './meetings.mapper';
import { MeetingsRepository } from './meetings.repository';
import type {
  MeetingCounts,
  MeetingFilters,
  MeetingType,
} from './meetings.types';
import type { MeetingEntryDto } from './dto/meetings.dto';
import { MeetingEventPort } from './ports/meeting-event.port';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const NO_MATCHES = 'No meetings match your filters.';

export interface ListMeetingsQuery {
  page?: number;
  limit?: number;
  bucket?: MeetingBucket;
  type?: MeetingType;
  eventId?: string;
  search?: string;
}

/**
 * Reading the meetings list (US-MTG-01/02).
 *
 * A search spans the EVENT's name as well as the meeting's own fields, so
 * "jazz" finds the venue call about the Jazz Festival and not only meetings
 * with "jazz" in the title. Events resolves those ids first — this module never
 * joins that table — and an empty result must narrow the search rather than
 * widen it, which is why the id list is only applied when it has entries.
 *
 * The tab counts deliberately ignore the bucket filter: the tabs describe the
 * whole list, so page 2 of Upcoming still says how many are in Past.
 */
@Injectable()
export class MeetingsQueryService {
  constructor(
    private readonly repo: MeetingsRepository,
    private readonly events: MeetingEventPort,
    private readonly clock: Clock,
  ) {}

  async list(
    auth: AuthContext,
    query: ListMeetingsQuery,
  ): Promise<{
    page: Paginated<MeetingEntryDto>;
    counts: MeetingCounts;
    emptyMessage: string | null;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const org = auth.organizationId;
    const eventIds = query.search
      ? await this.events.idsMatchingName(org, query.search)
      : undefined;
    const filters: MeetingFilters = { ...query, page, limit, eventIds };
    const countFilters: Omit<MeetingFilters, 'bucket'> = {
      page,
      limit,
      type: query.type,
      eventId: query.eventId,
      search: query.search,
      eventIds,
    };
    const [result, counts] = await Promise.all([
      this.repo.page(org, filters),
      this.repo.countByBucket(org, countFilters),
    ]);
    const names = await this.events.namesByIds(
      org,
      [...new Set(result.items.map((m) => m.eventId))].filter(
        (id): id is string => id !== null,
      ),
    );
    const now = this.clock.now();
    return {
      page: Paginated.of(
        result.items.map((row) =>
          toMeetingEntry(row, names.get(row.eventId ?? '') ?? null, now),
        ),
        result.total,
        page,
        limit,
      ),
      counts,
      emptyMessage: result.total === 0 ? NO_MATCHES : null,
    };
  }
}
