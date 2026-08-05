import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** The exact phrase the danger zone makes the user type — no accidental clicks. */
export const DELETE_CONFIRMATION = 'DELETE';
/** A recovery code is longer than a TOTP; both arrive through `code`. */
const MIN_CODE = 6;
const MAX_CODE = 32;

/** Confirm + re-verify identity before the account is deleted (US-DISC-14). */
export class DeleteAccountDto {
  @ApiProperty({
    example: DELETE_CONFIRMATION,
    description: `Must be exactly "${DELETE_CONFIRMATION}" — the explicit confirmation`,
  })
  @Equals(DELETE_CONFIRMATION, {
    message: `confirm must be exactly "${DELETE_CONFIRMATION}"`,
  })
  confirm!: string;

  @ApiProperty({ description: 'Current password — identity re-verification' })
  @IsString()
  @MinLength(1)
  password!: string;

  @ApiPropertyOptional({
    example: '123456',
    description:
      'Authenticator or recovery code — required when 2FA is enrolled',
  })
  @IsOptional()
  @IsString()
  @MinLength(MIN_CODE)
  @MaxLength(MAX_CODE)
  code?: string;
}
