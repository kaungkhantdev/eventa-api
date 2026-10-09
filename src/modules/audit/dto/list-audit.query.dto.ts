import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { auditTypeEnum } from '../../../db/schema';
import {
  AUDIT_SUBJECT_TYPES,
  type AuditSubjectType,
  type AuditType,
} from '../audit-subject';

const MAX_LIMIT = 200;
/** The act labels, read off the schema enum — never a re-typed list. */
const TYPES = auditTypeEnum.enumValues;

const SUBJECT_PAIR =
  'Send subjectType and subjectId together — half a subject matches nothing in particular.';

/**
 * Page, date range, act and subject filters for the audit log (US-SET-05, and
 * US-REG-08 AC5 for the subject pair).
 *
 * `subjectType` + `subjectId` answer "what happened to this record". They are
 * deliberately two fields rather than one `attendeeId`: the subject of an entry
 * is not always an attendee — a check-in's is a ticket, a payout's a reference
 * — so the shape the console queries does not have to change when the second
 * kind becomes filterable.
 *
 * Both or neither. The global pipe is `forbidNonWhitelisted`, so a mistyped
 * parameter is a 400 rather than a silent fall-back to the whole workspace, and
 * the pair rule closes the one remaining way to ask a narrow question and get a
 * broad answer.
 */
export class ListAuditQueryDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ enum: TYPES, example: 'attendee' })
  @IsOptional()
  @IsIn(TYPES)
  type?: AuditType;

  @ApiPropertyOptional({
    enum: AUDIT_SUBJECT_TYPES,
    description: 'The kind of record to read the trail of. Needs subjectId.',
  })
  @ValidateIf((dto: ListAuditQueryDto) => dto.subjectId !== undefined)
  @IsDefined({ message: SUBJECT_PAIR })
  @IsIn(AUDIT_SUBJECT_TYPES)
  subjectType?: AuditSubjectType;

  @ApiPropertyOptional({
    minimum: 1,
    example: 42,
    description: 'Which record of that kind. Needs subjectType.',
  })
  @ValidateIf((dto: ListAuditQueryDto) => dto.subjectType !== undefined)
  @IsDefined({ message: SUBJECT_PAIR })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  subjectId?: number;
}
