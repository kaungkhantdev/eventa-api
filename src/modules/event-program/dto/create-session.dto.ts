import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { sessionColorEnum, sessionTypeEnum } from '../../../db/schema';
import type { SessionColor, SessionType } from '../sessions.types';

const TYPES: readonly SessionType[] = sessionTypeEnum.enumValues;
const COLORS: readonly NonNullable<SessionColor>[] =
  sessionColorEnum.enumValues;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const MAX_DAY = 60;

export class CreateSessionDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: MAX_DAY,
    description: '1-based day index',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_DAY)
  day!: number;

  @ApiProperty({ example: '09:00', description: '24h HH:MM (or HH:MM:SS)' })
  @Matches(TIME, { message: 'startTime must be HH:MM (24h)' })
  startTime!: string;

  @ApiPropertyOptional({
    example: '10:00',
    description: '24h; must be > start',
  })
  @IsOptional()
  @Matches(TIME, { message: 'endTime must be HH:MM (24h)' })
  endTime?: string;

  @ApiProperty({ example: 'Opening Keynote', minLength: 1, maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiProperty({ enum: TYPES, example: 'Keynote' })
  @IsIn(TYPES)
  type!: SessionType;

  @ApiPropertyOptional({ example: 'Main Hall', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  room?: string;

  @ApiPropertyOptional({ enum: COLORS })
  @IsOptional()
  @IsIn(COLORS)
  color?: NonNullable<SessionColor>;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Speakers featured in this session (must belong to the event)',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  speakerIds?: string[];

  @ApiPropertyOptional({
    description:
      'Re-submit with true after a speaker-clash refusal to assign them anyway (US-PROG-05). A room clash can never be confirmed away.',
  })
  @IsOptional()
  @IsBoolean()
  confirmSpeakerClash?: boolean;
}
