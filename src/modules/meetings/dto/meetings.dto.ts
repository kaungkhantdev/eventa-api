import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  meetingModeEnum,
  meetingStatusEnum,
  meetingSyncStatusEnum,
  meetingTypeEnum,
} from '../../../db/schema';
import { MEETING_BUCKETS } from '../meeting-bucket';
import { MAX_LIMIT } from '../meetings-query.service';
import { MIN_TITLE } from '../meeting-schedule';

const MAX_TITLE = 200;
const MAX_PERSON = 120;
const MAX_ROLE = 120;
const MAX_EMAIL = 254;
const MAX_NOTES = 2000;
const MAX_REASON = 500;
/** `HH:MM`, 24-hour — the wall clock an organizer types. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'Use a 24-hour time like 09:30.';

export class ListMeetingsDto {
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

  @ApiPropertyOptional({
    enum: MEETING_BUCKETS,
    description: 'Omit for the All tab. Worked out from the Bangkok day.',
  })
  @IsOptional()
  @IsIn([...MEETING_BUCKETS])
  bucket?: (typeof MEETING_BUCKETS)[number];

  @ApiPropertyOptional({ enum: meetingTypeEnum.enumValues })
  @IsOptional()
  @IsIn([...meetingTypeEnum.enumValues])
  type?: (typeof meetingTypeEnum.enumValues)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiPropertyOptional({
    description: 'Matches title, person, role, type or the event name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class ScheduleMeetingDto {
  @ApiProperty({ minLength: MIN_TITLE, maxLength: MAX_TITLE })
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_TITLE)
  @MaxLength(MAX_TITLE)
  title!: string;

  @ApiProperty({ example: '2026-09-01', description: 'Bangkok calendar day.' })
  @IsISO8601({ strict: true })
  date!: string;

  @ApiProperty({ example: '09:00' })
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  startTime!: string;

  @ApiProperty({ example: '10:00' })
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  endTime!: string;

  @ApiProperty({ enum: meetingTypeEnum.enumValues })
  @IsIn([...meetingTypeEnum.enumValues])
  type!: (typeof meetingTypeEnum.enumValues)[number];

  @ApiProperty({ enum: meetingModeEnum.enumValues })
  @IsIn([...meetingModeEnum.enumValues])
  mode!: (typeof meetingModeEnum.enumValues)[number];

  @ApiProperty({ example: 'Khun Malee' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PERSON)
  person!: string;

  @ApiPropertyOptional({ example: 'Venue manager' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ROLE)
  role?: string;

  @ApiProperty({
    example: 'malee@venue.co.th',
    description: 'Where the calendar invite is sent.',
  })
  @IsEmail()
  @MaxLength(MAX_EMAIL)
  guestEmail!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Omit for a general meeting covering all events.',
  })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiPropertyOptional({ maxLength: MAX_NOTES })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTES)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Makes a double-submitted panel create one meeting, not two.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class RescheduleMeetingDto {
  @ApiProperty({
    description:
      'The version you loaded. A mismatch means someone else saved first.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ minLength: MIN_TITLE, maxLength: MAX_TITLE })
  @IsOptional()
  @IsString()
  @MinLength(MIN_TITLE)
  @MaxLength(MAX_TITLE)
  title?: string;

  @ApiPropertyOptional({ example: '2026-09-02' })
  @IsOptional()
  @IsISO8601({ strict: true })
  date?: string;

  @ApiPropertyOptional({ example: '11:00' })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  startTime?: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: TIME_MESSAGE })
  endTime?: string;

  @ApiPropertyOptional({ enum: meetingTypeEnum.enumValues })
  @IsOptional()
  @IsIn([...meetingTypeEnum.enumValues])
  type?: (typeof meetingTypeEnum.enumValues)[number];

  @ApiPropertyOptional({ enum: meetingModeEnum.enumValues })
  @IsOptional()
  @IsIn([...meetingModeEnum.enumValues])
  mode?: (typeof meetingModeEnum.enumValues)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PERSON)
  person?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ROLE)
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(MAX_EMAIL)
  guestEmail?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @ApiPropertyOptional({ maxLength: MAX_NOTES })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTES)
  notes?: string;
}

export class CancelMeetingDto {
  @ApiPropertyOptional({
    maxLength: MAX_REASON,
    description: 'Included in what the guest is told (US-MTG-06).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON)
  reason?: string;
}

export class MeetingEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ example: '2026-09-01' }) date!: string;
  @ApiProperty({ example: '09:00' }) startTime!: string;
  @ApiProperty({ example: '10:00' }) endTime!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'The UTC instant, resolved from the Bangkok wall clock.',
  })
  startsAt!: string;

  @ApiProperty({ example: 'Today · 09:00 – 10:00' }) timeLabel!: string;

  @ApiProperty({
    enum: MEETING_BUCKETS,
    description: 'Derived per request from the Bangkok day — never stored.',
  })
  bucket!: string;

  @ApiProperty() isToday!: boolean;
  @ApiProperty({ enum: meetingTypeEnum.enumValues }) type!: string;
  @ApiProperty({ enum: meetingModeEnum.enumValues }) mode!: string;
  @ApiProperty({ enum: meetingStatusEnum.enumValues }) status!: string;
  @ApiProperty() person!: string;
  @ApiProperty({ nullable: true }) role!: string | null;
  @ApiProperty() guestEmail!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) eventId!: string | null;

  @ApiProperty({ nullable: true, description: 'Null for a general meeting.' })
  eventName!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'The join link, the venue, or "Phone call".',
  })
  place!: string | null;

  @ApiProperty({ nullable: true }) link!: string | null;
  @ApiProperty({ nullable: true }) notes!: string | null;

  @ApiProperty({
    enum: meetingSyncStatusEnum.enumValues,
    description: 'Whether the calendar invite has gone out yet (US-MTG-04).',
  })
  syncStatus!: string;

  @ApiProperty({ description: 'Video, not past, link ready, not cancelled.' })
  canJoin!: boolean;

  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ nullable: true }) cancellationReason!: string | null;

  @ApiProperty({ description: 'Send this back when rescheduling.' })
  version!: number;
}

export class MeetingCountsDto {
  @ApiProperty() all!: number;
  @ApiProperty() today!: number;
  @ApiProperty() upcoming!: number;
  @ApiProperty() past!: number;
}
