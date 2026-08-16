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

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const MAX_SEARCH = 120;

/** Someone is either already inside, or still expected. */
export const ATTENDANCE_STATUSES = ['checked_in', 'expected'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * By name reads like a list to work down; by arrival reads like a feed of who
 * just walked in. The queue wants the first, the station the second.
 */
export const ATTENDANCE_SORTS = ['name', 'recent'] as const;
export type AttendanceSort = (typeof ATTENDANCE_SORTS)[number];

/** Who is expected at this event, and who is already inside (US-REG-11). */
export class ListAttendanceDto {
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

  @ApiPropertyOptional({
    enum: ATTENDANCE_STATUSES,
    description: 'Omit for everyone holding a ticket.',
  })
  @IsOptional()
  @IsIn(ATTENDANCE_STATUSES)
  status?: AttendanceStatus;

  @ApiPropertyOptional({ description: 'Holder name or ticket label.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH)
  search?: string;

  @ApiPropertyOptional({ enum: ATTENDANCE_SORTS, default: 'name' })
  @IsOptional()
  @IsIn(ATTENDANCE_SORTS)
  sort?: AttendanceSort;
}

/** One person on the roll. */
export class AttendanceRowDto {
  @ApiProperty({ format: 'uuid' })
  ticketId!: string;

  @ApiProperty({ nullable: true, description: 'Null when nobody was named.' })
  holderName!: string | null;

  @ApiProperty({
    nullable: true,
    description: "The attendee's address, or the buyer's when unassigned.",
  })
  attendeeEmail!: string | null;

  @ApiProperty({ nullable: true })
  ticketLabel!: string | null;

  @ApiProperty({ description: 'The tier this ticket was bought on.' })
  ticketTypeName!: string;

  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  status!: AttendanceStatus;

  @ApiProperty({
    nullable: true,
    description: 'When they walked in; null while they are still expected.',
  })
  checkedInAt!: string | null;

  @ApiProperty({ nullable: true, description: 'How they were admitted.' })
  method!: string | null;
}

/**
 * The room, counted.
 *
 * Returned alongside the page rather than derived from it: the station shows
 * these while looking at eight rows of a thousand, and counting what is on
 * screen would be wrong on every page but the last.
 */
export class AttendanceCountsDto {
  @ApiProperty({
    description: 'Everyone holding a ticket that entitles entry.',
  })
  total!: number;

  @ApiProperty() checkedIn!: number;

  @ApiProperty() expected!: number;
}
