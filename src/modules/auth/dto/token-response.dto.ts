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

/** One of the workspaces a verified password opens (US-ACC-02). */
export class WorkspaceOptionDto {
  @ApiProperty({ example: 'acme-events' })
  slug!: string;

  @ApiProperty({ example: 'Acme Events' })
  name!: string;
}

/**
 * A login answers one of three ways.
 *
 * Tokens, when the password alone suffices. `twoFactorRequired` with a
 * short-lived challenge token when a code must follow (US-ACC-05). Or
 * `chooseWorkspace` when the address and password open more than one workspace
 * — the caller shows the list and posts one of the slugs straight back.
 *
 * In the latter two, NO token or user detail is present. `expiresIn` describes
 * whichever was issued, and is 0 when nothing was.
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
  expiresIn?: number;

  @ApiPropertyOptional({
    description: 'Long-lived refresh token (POST to /auth/refresh)',
  })
  refreshToken?: string;

  @ApiPropertyOptional({ type: MeResponseDto })
  user?: MeResponseDto;

  @ApiPropertyOptional({
    description:
      'Present when the password opens several workspaces and one must be named',
  })
  chooseWorkspace?: boolean;

  @ApiPropertyOptional({ type: [WorkspaceOptionDto] })
  workspaces?: WorkspaceOptionDto[];
}
