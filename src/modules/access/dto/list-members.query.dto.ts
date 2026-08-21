import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { memberStatusEnum } from '../../../db/schema';

const STATUSES = memberStatusEnum.enumValues;
/** Long enough for any name or address; a bound, not a rule. */
const MAX_SEARCH = 120;

/**
 * The Users screen's filters (US-ACC-02).
 *
 * All three are applied SERVER-side because the list is paged server-side. A
 * browser filtering the page it happens to be holding would show rows that
 * disagree with both the tab counts and the paginator.
 */
export class ListMembersQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Matches a name or an email, case-insensitively. */
  @ApiPropertyOptional({ example: 'anong' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH)
  search?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn([...STATUSES])
  status?: (typeof STATUSES)[number];

  @ApiPropertyOptional({ description: 'Only members holding this role' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roleId?: number;
}
