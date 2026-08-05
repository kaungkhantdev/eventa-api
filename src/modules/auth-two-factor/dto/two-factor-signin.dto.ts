import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** A recovery code is longer than a TOTP; both arrive through `code`. */
const MIN_CODE = 6;
const MAX_CODE = 32;

/** Trade the login challenge plus a code for a session (US-ACC-05). */
export class TwoFactorSignInDto {
  @ApiProperty({ description: 'From the login response that required a code' })
  @IsString()
  @MinLength(16)
  challengeToken!: string;

  @ApiProperty({
    example: '123456',
    description: 'A 6-digit authenticator code, or a recovery code',
  })
  @IsString()
  @MinLength(MIN_CODE)
  @MaxLength(MAX_CODE)
  code!: string;
}
