import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const MAX_NAME = 200;
const MAX_DESCRIPTOR = 22;

/** Legal identity + branding an Admin may change (US-SET-07). */
export class UpdateOrganizationDto {
  @ApiPropertyOptional({ maxLength: MAX_NAME })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NAME)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  address?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'https://acme.co.th' })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  website?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '0105556012345' })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  taxId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  logoUrl?: string | null;

  @ApiPropertyOptional({ example: 'Asia/Bangkok' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: MAX_DESCRIPTOR })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(MAX_DESCRIPTOR)
  @Matches(/^[A-Za-z0-9 .,'-]*$/, {
    message: "statementDescriptor may use letters, numbers, spaces . , ' -",
  })
  statementDescriptor?: string | null;
}
