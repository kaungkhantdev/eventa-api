import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsIn,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { EventType } from '../events.types';

export const EVENT_TYPES: readonly EventType[] = [
  'Conference',
  'Networking',
  'Workshop',
  'Charity & Gala',
  'Sports & Wellness',
  'Concert & Festival',
  'Exhibition',
  'Seminar',
];

export class CreateEventDto {
  @ApiProperty({
    example: 'Bangkok Tech Conference 2026',
    minLength: 3,
    maxLength: 120,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: EVENT_TYPES, example: 'Conference' })
  @IsIn(EVENT_TYPES)
  type!: EventType;

  @ApiProperty({ example: '2026-09-01T09:00:00+07:00', format: 'date-time' })
  @IsISO8601()
  startAt!: string;

  @ApiPropertyOptional({ maxLength: 250 })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  description?: string;

  @ApiPropertyOptional({ example: 3, description: 'Workspace category id' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  categoryId?: number;

  @ApiPropertyOptional({
    maxLength: 120,
    description: 'Defaults to the workspace name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizerName?: string;
}
