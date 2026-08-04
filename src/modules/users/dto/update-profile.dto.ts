import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { localeEnum } from '../../../db/schema';

const LOCALES = localeEnum.enumValues;

/** Fields a member may change on their own profile (US-SET-01). */
export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true, example: '+66812345678' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Asia/Bangkok' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  timezone?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: LOCALES })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn([...LOCALES])
  locale?: 'en' | 'th' | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  avatarUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Bangkok' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '1995-04-12' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  bio?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'THB',
    description: 'Display only — charges always settle in THB (US-DISC-12)',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^[A-Z]{3}$/)
  displayCurrency?: string | null;
}
