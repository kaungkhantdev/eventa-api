import { Injectable } from '@nestjs/common';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { PermissionsService } from '../access/permissions.service';
import { AuditRepository, type AuditRecord } from './audit.repository';
import {
  type AuditSubjectFilter,
  type AuditSubjectType,
  type AuditType,
  toSubjectFilter,
} from './audit-subject';
import { AuditEntryDto, toAuditEntry } from './dto/audit-entry.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListAuditQuery {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  /** One kind of act. */
  type?: AuditType;
  /** Which record to read the trail of — both halves, or neither. */
  subjectType?: AuditSubjectType;
  subjectId?: number;
}

/**
 * The security & access audit log (US-SET-05). Append-only: this service can read
 * and export, and the only write it makes is recording an export — nothing in the
 * product edits or deletes an entry.
 *
 * Visibility: an Admin (`setUsers`) sees the whole workspace; anyone else sees
 * only their own security events. The route itself carries no
 * `@RequirePermissions`, so that narrowing is the whole of the authorization —
 * which is why every filter here is applied as an additional AND and the actor
 * pin is spread last, where nothing can overwrite it.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly repo: AuditRepository,
    private readonly permissions: PermissionsService,
  ) {}

  async list(
    auth: AuthContext,
    query: ListAuditQuery,
  ): Promise<Paginated<AuditEntryDto>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const { items, total } = await this.repo.page(auth.organizationId, {
      ...parseRange(query),
      ...parseFilters(query),
      ...(await this.scope(auth)),
      limit,
      offset: (page - 1) * limit,
    });
    return Paginated.of(items.map(toAuditEntry), total, page, limit);
  }

  /**
   * Export a date range. The export is itself recorded as a new entry, so a
   * download of sensitive history is never invisible.
   */
  async export(
    auth: AuthContext,
    query: ListAuditQuery,
  ): Promise<{ filename: string; csv: string }> {
    const range = parseRange(query);
    const rows = await this.repo.all(auth.organizationId, {
      ...range,
      ...parseFilters(query),
      ...(await this.scope(auth)),
    });
    await this.repo.recordExport(
      auth.organizationId,
      auth.userId,
      `Exported ${rows.length} audit entries`,
    );
    return { filename: exportName(range), csv: toCsv(rows) };
  }

  /** Non-Admins are pinned to their own events. */
  private async scope(auth: AuthContext): Promise<{ actorUserId?: string }> {
    const granted = await this.permissions.getFor(
      auth.organizationId,
      auth.userId,
    );
    return granted.includes(Permission.setUsers)
      ? {}
      : { actorUserId: auth.userId };
  }
}

/**
 * The act/subject filters, resolved once for both the page and the export.
 *
 * A half-given subject is dropped rather than guessed. `subjectId` alone could
 * only mean "any record with this id", which across subject kinds is not a
 * question with an answer; answering it as an unfiltered workspace list is how
 * a panel meant for one attendee would quietly render everyone's trail. The DTO
 * refuses the half pair at the edge, so this is the second line of that defence
 * for any caller that reaches the service directly.
 */
function parseFilters(query: ListAuditQuery): {
  type?: AuditType;
  subject?: AuditSubjectFilter;
} {
  const subject =
    query.subjectType !== undefined && query.subjectId !== undefined
      ? toSubjectFilter({ type: query.subjectType, id: query.subjectId })
      : undefined;
  return {
    ...(query.type ? { type: query.type } : {}),
    ...(subject ? { subject } : {}),
  };
}

function parseRange(query: ListAuditQuery): { from?: Date; to?: Date } {
  return {
    ...(query.from ? { from: new Date(query.from) } : {}),
    ...(query.to ? { to: new Date(query.to) } : {}),
  };
}

function exportName(range: { from?: Date; to?: Date }): string {
  const day = (d?: Date) => (d ? d.toISOString().slice(0, 10) : 'all');
  return `audit-${day(range.from)}-to-${day(range.to)}.csv`;
}

/** RFC-4180-ish escaping so a title with a comma or quote can't break a column. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toCsv(rows: AuditRecord[]): string {
  const header = 'occurredAt,type,title,actor,ipAddress';
  const lines = rows.map((r) =>
    [
      r.occurredAt.toISOString(),
      r.type,
      csvCell(r.title),
      csvCell(r.actorName ?? ''),
      r.ipAddress ?? '',
    ].join(','),
  );
  return [header, ...lines].join('\n');
}
