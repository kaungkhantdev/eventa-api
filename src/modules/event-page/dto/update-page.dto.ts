import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { templateIdEnum } from '../../../db/schema';

const TEMPLATES = templateIdEnum.enumValues;

/** Design, public address and branding for an event's page (US-PAGE-10). */
export class UpdatePageDto {
  @ApiPropertyOptional({ enum: TEMPLATES })
  @IsOptional()
  @IsIn([...TEMPLATES])
  template?: (typeof TEMPLATES)[number];

  @ApiPropertyOptional({ example: 'bangkok-summit-2026' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @ApiPropertyOptional({ example: '#2563EB' })
  @IsOptional()
  @IsString()
  @MaxLength(9)
  accentColor?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(80)
  agendaTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(80)
  speakersTitle?: string | null;
}
