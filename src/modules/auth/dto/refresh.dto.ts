import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'A refresh token from /auth/login' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
