import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { attendeeTagEnum } from '../../../db/schema';
import type { AttendeeTag, Segment, SortBy } from '../attendee-directory.types';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
const MAX_SEARCH = 120;

const SEGMENTS: readonly Segment[] = ['all', 'new', 'checked_in', 'vip'];
const SORTS: readonly SortBy[] = ['recent', 'name', 'events', 'tickets'];

/** Narrow and order the attendee directory (US-REG-05). */
export class ListAttendeesDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ enum: SEGMENTS })
  @IsOptional()
  @IsIn(SEGMENTS)
  segment?: Segment;

  @ApiPropertyOptional({ enum: attendeeTagEnum.enumValues })
  @IsOptional()
  @IsIn(attendeeTagEnum.enumValues)
  tag?: AttendeeTag;

  @ApiPropertyOptional({ description: 'Matches name or email.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH)
  search?: string;

  @ApiPropertyOptional({
    enum: SORTS,
    default: 'recent',
    description: 'Ties always break on most recent activity.',
  })
  @IsOptional()
  @IsIn(SORTS)
  sort?: SortBy;
}

export class AttendeeEntryDto {
  @ApiProperty({ example: 42 })
  id!: number;

  @ApiProperty({ example: 'Anan Suksawat' })
  name!: string;

  @ApiProperty({ example: 'anan@example.com' })
  email!: string;

  @ApiProperty({ nullable: true })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  company!: string | null;

  @ApiProperty({ enum: attendeeTagEnum.enumValues, nullable: true })
  tag!: AttendeeTag | null;

  @ApiProperty({ type: String, format: 'date-time' })
  firstSeenAt!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastActivityAt!: string | null;

  @ApiProperty({ example: 3, description: 'Distinct events registered for.' })
  eventCount!: number;

  @ApiProperty({ example: 5 })
  ticketCount!: number;

  @ApiProperty({ example: 2, description: 'Tickets actually used at a door.' })
  checkedInCount!: number;
}

export class SegmentCountsDto {
  @ApiProperty() all!: number;
  @ApiProperty() new!: number;
  @ApiProperty() checkedIn!: number;
  @ApiProperty() vip!: number;
}
