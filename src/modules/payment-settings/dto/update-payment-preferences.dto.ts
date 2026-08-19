import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const MAX_DESCRIPTOR = 22;

/** Checkout & receipt preferences (US-SET-10). */
export class UpdatePaymentPreferencesDto {
  @ApiPropertyOptional({ example: 'THB' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'defaultCurrency must be a 3-letter code' })
  defaultCurrency?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: MAX_DESCRIPTOR })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(MAX_DESCRIPTOR)
  statementDescriptor?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  saveCards?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailReceipts?: boolean;
}
