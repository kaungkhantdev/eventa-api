import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { templateIdEnum } from '../../../db/schema';

const TEMPLATES = templateIdEnum.enumValues;

/**
 * Unsaved values to render (US-PAGE-09). Everything is optional — an organizer
 * previews mid-edit, so a half-filled form must still render.
 */
export class PreviewPageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  description?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() type?: string;

  @ApiPropertyOptional() @IsOptional() @IsISO8601() startAt?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601()
  endAt?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isOnline?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  onlineNote?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  venueName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  venueAddress?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  city?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  coverImage?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() accentColor?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() organizerName?: string;

  @ApiPropertyOptional({ enum: TEMPLATES })
  @IsOptional()
  @IsIn([...TEMPLATES])
  template?: (typeof TEMPLATES)[number];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  highlights?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  agendaTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  speakersTitle?: string | null;
}
