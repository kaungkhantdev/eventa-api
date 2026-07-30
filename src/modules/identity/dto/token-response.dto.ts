import { ApiProperty } from '@nestjs/swagger';
import { MeResponseDto } from './user-response.dto';

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

export class LoginResponseDto extends RefreshResponseDto {
  @ApiProperty({
    description: 'Long-lived refresh token (POST to /auth/refresh)',
  })
  refreshToken!: string;

  @ApiProperty({ type: MeResponseDto })
  user!: MeResponseDto;
}
