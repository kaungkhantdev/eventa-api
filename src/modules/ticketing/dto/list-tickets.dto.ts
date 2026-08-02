import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ticketStatusEnum } from '../../../db/schema';
import type { TicketStatus } from '../ticketing.types';

const STATUSES: readonly TicketStatus[] = ticketStatusEnum.enumValues;
const MAX_LIMIT = 100;
const MAX_SEARCH = 120;

/** Filters for the cross-event ticket inventory (US-TKT-04). */
export class ListTicketsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: TicketStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiPropertyOptional({
    example: 'jazz',
    description: "Matches a tier's name or the name of the event it belongs to",
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH)
  search?: string;
}
