import { ApiProperty } from '@nestjs/swagger';
import type { AuditRecord } from '../audit.repository';

/** Anything that looks like a secret is shown as a hint, never in full. */
const SECRET_HINT = /((?:sk|pk|rk)_[A-Za-z0-9_]+|[A-Za-z0-9]{24,})/g;

/** One immutable entry in the security & access log (US-SET-05). */
export class AuditEntryDto {
  @ApiProperty() id!: number;
  @ApiProperty() type!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) meta!: string | null;
  @ApiProperty({ nullable: true }) actorName!: string | null;
  @ApiProperty({ nullable: true }) ipAddress!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
}

/** Mask any secret-looking run to its last 4 characters. */
export function maskSecrets(value: string): string {
  return value.replace(SECRET_HINT, (m) => `••••${m.slice(-4)}`);
}

export function toAuditEntry(row: AuditRecord): AuditEntryDto {
  return {
    id: row.id,
    type: row.type,
    title: maskSecrets(row.title),
    meta: row.meta === null ? null : maskSecrets(row.meta),
    actorName: row.actorName,
    ipAddress: row.ipAddress,
    occurredAt: row.occurredAt.toISOString(),
  };
}
