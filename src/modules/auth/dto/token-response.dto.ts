import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MeResponseDto } from '../../users/dto/user-response.dto';

export class RefreshResponseDto {
  @ApiProperty({
    description: 'JWT access token (send as `Authorization: Bearer`)',
  })
  accessToken!: string;

  @ApiProperty({ default: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ description: 'Access token lifetime, seconds' })
  expiresIn!: number;
}

/**
 * A login answers one of two ways (US-ACC-05): tokens when the password alone
 * suffices, or `twoFactorRequired` with a short-lived challenge token when a
 * code must follow — in which case NO token or user detail is present.
 * `expiresIn` describes whichever was issued.
 */
export class LoginResponseDto {
  @ApiProperty({ default: false })
  twoFactorRequired!: boolean;

  @ApiPropertyOptional({
    description:
      'Present only when a code is required; POST to /auth/two-factor',
  })
  challengeToken?: string;

  @ApiPropertyOptional({
    description: 'JWT access token (send as `Authorization: Bearer`)',
  })
  accessToken?: string;

  @ApiPropertyOptional({ default: 'Bearer' })
  tokenType?: string;

  @ApiProperty({
    description: 'Lifetime of the access token — or of the challenge — seconds',
  })
  expiresIn!: number;

  @ApiPropertyOptional({
    description: 'Long-lived refresh token (POST to /auth/refresh)',
  })
  refreshToken?: string;

  @ApiPropertyOptional({ type: MeResponseDto })
  user?: MeResponseDto;
}
