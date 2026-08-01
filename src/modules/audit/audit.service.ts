import { Injectable } from '@nestjs/common';
import { Permission } from '../../common/decorators/require-permissions.decorator';
import { Paginated } from '../../common/http/paginated';
import type { AuthContext } from '../auth/auth.types';
import { PermissionsService } from '../access/permissions.service';
import { AuditRepository, type AuditRecord } from './audit.repository';
import { AuditEntryDto, toAuditEntry } from './dto/audit-entry.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListAuditQuery {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
}

/**
 * The security & access audit log (US-SET-05). Append-only: this service can read
 * and export, and the only write it makes is recording an export — nothing in the
 * product edits or deletes an entry.
 *
 * Visibility: an Admin (`setUsers`) sees the whole workspace; anyone else sees
 * only their own security events.
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
      ...(await this.scope(auth)),
      ...parseRange(query),
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
      ...(await this.scope(auth)),
      ...range,
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
