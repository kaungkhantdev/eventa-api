import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { speakerToneEnum } from '../../../../db/schema';
import type { SpeakerTone } from '../speakers.types';

const TONES: readonly NonNullable<SpeakerTone>[] = speakerToneEnum.enumValues;

export class CreateSpeakerDto {
  @ApiProperty({ example: 'Ada Lovelace', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'CTO, Analytical Engines', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  role?: string;

  @ApiPropertyOptional({ format: 'email' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: 'The Analytical Engine', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  talkTitle?: string;

  @ApiPropertyOptional({ example: 'Keynote', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @ApiPropertyOptional({ example: 'AL', maxLength: 4 })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  initials?: string;

  @ApiPropertyOptional({ enum: TONES })
  @IsOptional()
  @IsIn(TONES)
  tone?: SpeakerTone;
}
