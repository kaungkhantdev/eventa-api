import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_SPAN_DAYS,
  REPORT_RANGES,
  type ReportRange,
} from '../reports-period';

/**
 * The one filter every report takes (US-RPT-02).
 *
 * Shared rather than repeated per report, because the story requires the same
 * four controls everywhere and US-RPT-12 requires the reports to agree with each
 * other — which they cannot do if each parses its own window.
 *
 * The date pair is validated for SHAPE here and for MEANING in
 * `resolveReportPeriod`: that an end is not before its start, and that a span is
 * within the cap, are decisions with defined behaviour (a message, a trim) which
 * belong with the rest of the window logic rather than in a decorator.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = 'must be a calendar day, as YYYY-MM-DD';

export const DEFAULT_REPORT_LIMIT = 20;
export const MAX_REPORT_LIMIT = 100;

export class ReportFilterQueryDto {
  @ApiPropertyOptional({
    description: `Bangkok calendar day the window opens. Spans longer than ${MAX_SPAN_DAYS} days are trimmed.`,
    example: '2026-01-01',
  })
  @IsOptional()
  @Matches(DAY, { message: `from ${DAY_MESSAGE}` })
  from?: string;

  @ApiPropertyOptional({
    description: 'Bangkok calendar day the window closes, inclusive.',
    example: '2026-07-19',
  })
  @IsOptional()
  @Matches(DAY, { message: `to ${DAY_MESSAGE}` })
  to?: string;

  @ApiPropertyOptional({
    enum: REPORT_RANGES,
    default: 'year',
    description: 'A named window. Ignored when `from` or `to` is given.',
  })
  @IsOptional()
  @IsIn(REPORT_RANGES)
  range?: ReportRange;

  @ApiPropertyOptional({
    description: 'One event, or every event when omitted.',
  })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiPropertyOptional({
    description: 'Free-text search across the report’s own rows.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_REPORT_LIMIT,
    default: DEFAULT_REPORT_LIMIT,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_REPORT_LIMIT)
  limit?: number;
}
