import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsISO8601,
  IsIn,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { seatingModeEnum, templateIdEnum } from '../../../db/schema';
import type { EventType, SeatingMode, TemplateId } from '../events.types';
import { EVENT_TYPES } from './create-event.dto';

const SEATING_MODES: readonly SeatingMode[] = seatingModeEnum.enumValues;
const TEMPLATES: readonly TemplateId[] = templateIdEnum.enumValues;

/** Partial update to an event's Basics + Date/Location. Omit a field to leave it. */
export class UpdateEventDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  description?: string;

  @ApiPropertyOptional({ enum: EVENT_TYPES })
  @IsOptional()
  @IsIn(EVENT_TYPES)
  type?: EventType;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'null clears it',
  })
  @IsOptional()
  @ValidateIf((o: UpdateEventDto) => o.categoryId !== null)
  @IsInt()
  @IsPositive()
  categoryId?: number | null;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'null clears it',
  })
  @IsOptional()
  @ValidateIf((o: UpdateEventDto) => o.endAt !== null)
  @IsISO8601()
  endAt?: string | null;

  @ApiPropertyOptional({ example: 'Asia/Bangkok' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  venueName?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  venueAddress?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  onlineNote?: string;

  @ApiPropertyOptional({ enum: SEATING_MODES })
  @IsOptional()
  @IsIn(SEATING_MODES)
  seatingMode?: SeatingMode;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  capacity?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverImage?: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  accentColor?: string;

  @ApiPropertyOptional({ example: 'events@acme.test' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  @ApiPropertyOptional({
    enum: templateIdEnum.enumValues,
    description:
      'Public landing-page template. Settable while the event is live — changing the look must not require unpublishing it.',
  })
  @IsOptional()
  @IsIn(TEMPLATES)
  landingTemplateId?: TemplateId;

  @ApiPropertyOptional({
    description: 'Optimistic-concurrency token (from GET)',
  })
  @IsOptional()
  @IsInt()
  version?: number;
}
