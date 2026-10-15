import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import {
  MessageDeliveriesRepository,
  type DeliveryFilter,
  type DeliveryRow,
} from './message-deliveries.repository';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/**
 * How many rows an export carries.
 *
 * A ceiling rather than no limit: US-MSG-07's "very large export" belongs with
 * the prepared-file-and-notification slice, and until that exists a log of a
 * hundred thousand sends is truncated rather than left to time out mid-download.
 */
const EXPORT_LIMIT = 5000;
const NOTHING_TO_EXPORT =
  'There is nothing to export — no messages match these filters.';

export type DeliveriesQuery = Partial<
  Pick<DeliveryFilter, 'status' | 'kind' | 'q' | 'page' | 'limit'>
>;

/**
 * The delivery log (US-MSG-06): what was sent, to whom, and what became of it.
 *
 * Read-only, and deliberately so. Nothing here re-sends: a message that failed
 * failed for a reason — a dead address, a full mailbox — and a retry button
 * that fired the same message at the same address would look like an action
 * while changing nothing. Fixing the address is done where the address lives.
 */
@Injectable()
export class MessageDeliveriesService {
  constructor(private readonly repo: MessageDeliveriesRepository) {}

  async list(
    auth: AuthContext,
    query: DeliveriesQuery,
  ): Promise<Paginated<DeliveryRow>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const { rows, total, failed } = await this.repo.list(auth.organizationId, {
      status: query.status,
      kind: query.kind,
      q: query.q,
      page,
      limit,
    });
    // `failed` rides along in meta because it describes the whole matched set,
    // not this page of it — the number an organizer is looking for is "how many
    // of these went wrong", and counting the rows on screen would answer a
    // different question on every page.
    return Paginated.of(rows, total, page, limit).withMeta({ failed });
  }

  /**
   * The same rows the list would return under the same filters, unpaged.
   * A paged export is a bug, not a feature.
   *
   * US-MSG-07: an empty view is refused with a reason rather than downloaded
   * as a header-only file, and an export that happens is recorded for audit,
   * because the file is attendee contact data in bulk.
   */
  async forExport(
    auth: AuthContext,
    query: DeliveriesQuery,
  ): Promise<DeliveryRow[]> {
    const { rows } = await this.repo.list(auth.organizationId, {
      status: query.status,
      kind: query.kind,
      q: query.q,
      page: DEFAULT_PAGE,
      limit: EXPORT_LIMIT,
    });
    if (rows.length === 0) throw DomainException.conflict(NOTHING_TO_EXPORT);
    await this.repo.recordExport(
      auth.organizationId,
      auth.userId,
      `Exported ${rows.length} delivery log rows`,
    );
    return rows;
  }

  kinds(auth: AuthContext): Promise<string[]> {
    return this.repo.kinds(auth.organizationId);
  }
}
